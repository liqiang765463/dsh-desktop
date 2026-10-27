import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { dataHome, findApp } from '../scripts/window-locations.mjs'
import { installPackage, rollback, recover, tree, manifestPackage } from '../scripts/portable-upgrade.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-upgrade-'))
  const app = join(root, 'Custom Apps/DSH NEXT.app'), bundle = join(root, 'delivery'), home = join(root, 'My DSH Data')
  for (const [base, value] of [[app, 'old'], [join(bundle, 'DSH NEXT.app'), 'new']]) {
    mkdirSync(join(base, 'Contents/Resources'), { recursive: true })
    writeFileSync(join(base, 'Contents/Resources/app.asar'), value)
  }
  mkdirSync(join(home, 'profiles/desktop'), { recursive: true })
  writeFileSync(join(home, 'profiles/desktop/cordis.patch.yml'), 'original-plugin-config')
  writeFileSync(join(home, 'desktop-windows.json'), '{"original":"binding"}')
  manifestPackage(bundle, { version: 'test', architectures: [process.arch] })
  const options = { app, home, state: join(root, 'state'), validate: () => {}, running: () => [], copy: undefined }
  return { root, app, bundle, home, options, close: () => rmSync(root, { recursive: true, force: true }) }
}
describe('portable Mac upgrade transactions', () => {
  it('discovers a custom data location and refuses ambiguous applications', () => {
    const f = fixture()
    try {
      const anchor = join(f.root, 'Library/Application Support/DSH NEXT/home')
      mkdirSync(anchor, { recursive: true }); writeFileSync(join(anchor, 'desktop-next-location.json'), JSON.stringify({ home: f.home }))
      expect(dataHome({ userHome: f.root, env: {} })).toBe(f.home)
      expect(findApp({ candidates: [f.app], env: {} })).toBe(f.app)
      expect(() => findApp({ candidates: [f.app, join(f.bundle, 'DSH NEXT.app')], env: {} })).toThrow('Multiple')
      writeFileSync(join(anchor, 'desktop-next-location.json'), '{"home":"relative"}')
      expect(() => dataHome({ userHome: f.root, env: {} })).toThrow('refusing to guess')
    } finally { f.close() }
  })
  it('installs and rolls back without touching plugin configuration or window bindings', () => {
    const f = fixture()
    try {
      const before = tree(f.home), receipt = installPackage(f.bundle, f.options)
      expect(readFileSync(join(f.app, 'Contents/Resources/app.asar'), 'utf8')).toBe('new')
      expect(tree(f.home)).toEqual(before)
      expect(receipt.phase).toBe('installed')
      rollback(receipt.file, f.options)
      expect(readFileSync(join(f.app, 'Contents/Resources/app.asar'), 'utf8')).toBe('old')
      expect(tree(f.home)).toEqual(before)
    } finally { f.close() }
  })
  it('rejects tampering anywhere in the delivered application before touching the old app', () => {
    const f = fixture()
    try {
      writeFileSync(join(f.bundle, 'DSH NEXT.app/Contents/Resources/app.asar'), 'tampered')
      expect(() => installPackage(f.bundle, f.options)).toThrow('Package files changed')
      expect(readFileSync(join(f.app, 'Contents/Resources/app.asar'), 'utf8')).toBe('old')
    } finally { f.close() }
  })
  it('refuses installation or rollback while any target application process is running', () => {
    const f = fixture()
    try {
      expect(() => installPackage(f.bundle, { ...f.options, running: () => ['renderer'] })).toThrow('DSH_RUNNING')
      const r = installPackage(f.bundle, f.options)
      expect(() => rollback(r.file, { ...f.options, running: () => ['host'] })).toThrow('DSH_RUNNING')
    } finally { f.close() }
  })
  it('restores the old app if switching to the staged app fails', () => {
    const f = fixture()
    try {
      expect(() => installPackage(f.bundle, { ...f.options, fault: phase => { if (phase === 'old_moved') throw new Error('simulated disk failure') } })).toThrow('simulated disk failure')
      expect(readFileSync(join(f.app, 'Contents/Resources/app.asar'), 'utf8')).toBe('old')
    } finally { f.close() }
  })
  it('rejects rollback after a different application update, preserving both versions', () => {
    const f = fixture()
    try {
      const r = installPackage(f.bundle, f.options)
      writeFileSync(join(f.app, 'Contents/Resources/app.asar'), 'later update')
      expect(() => rollback(r.file, f.options)).toThrow('Application changed')
      expect(existsSync(r.backup)).toBe(true)
    } finally { f.close() }
  })
  it('preserves later user settings when rolling back the program', () => {
    const f = fixture()
    try {
      const r = installPackage(f.bundle, f.options)
      writeFileSync(join(f.home, 'profiles/desktop/cordis.patch.yml'), 'later user setting')
      rollback(r.file, f.options)
      expect(readFileSync(join(f.home, 'profiles/desktop/cordis.patch.yml'), 'utf8')).toBe('later user setting')
    } finally { f.close() }
  })
  it('recovers a missing application after an interrupted rename using the verified backup', () => {
    const f = fixture()
    try {
      const r = installPackage(f.bundle, f.options)
      rmSync(f.app, { recursive: true }); r.phase = 'old_moved'; writeFileSync(r.file, JSON.stringify(r))
      recover(r.file, f.options)
      expect(readFileSync(join(f.app, 'Contents/Resources/app.asar'), 'utf8')).toBe('old')
    } finally { f.close() }
  })
  it('refuses recovery while the recorded transaction owner is still alive', () => {
    const f = fixture()
    try {
      const r = installPackage(f.bundle, f.options), lock = join(f.options.state, 'lock')
      mkdirSync(lock); writeFileSync(join(lock, 'owner.json'), JSON.stringify({ schema: 1, purpose: 'dsh-next-upgrade', pid: process.pid }))
      expect(() => recover(r.file, f.options)).toThrow('still running')
      expect(existsSync(lock)).toBe(true)
    } finally { f.close() }
  })
  it('refuses linked application destinations and a pre-existing transaction lock', () => {
    const f = fixture()
    try {
      const link = join(f.root, 'Alias.app'); symlinkSync(f.app, link)
      expect(() => installPackage(f.bundle, { ...f.options, app: link })).toThrow('symbolic')
      mkdirSync(join(f.options.state, 'lock'), { recursive: true })
      expect(() => installPackage(f.bundle, f.options)).toThrow('UPGRADE_LOCKED')
    } finally { f.close() }
  })
  it('records links without following them or disclosing configuration values', () => {
    const f = fixture()
    try {
      symlinkSync('app.asar', join(f.app, 'Contents/Resources/current'))
      const files = tree(f.app)
      expect(files['Contents/Resources/current']).toBe('link:app.asar')
      expect(JSON.stringify(files)).not.toContain('old')
    } finally { f.close() }
  })
})
