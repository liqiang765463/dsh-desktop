/** Mac application-only transactions: never copies, rewrites or downgrades user data. */
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dataHome, findApp } from './window-locations.mjs'
import { member, overlay } from './portable-asar.mjs'

const scripts = dirname(fileURLToPath(import.meta.url))
export function sha(file) {
  const fd = openSync(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024)
  try { let count; while ((count = readSync(fd, buffer))) hash.update(buffer.subarray(0, count)); return hash.digest('hex') }
  finally { closeSync(fd) }
}
export function tree(root, prefix = '') {
  const result = {}
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name), key = (prefix ? prefix + '/' : '') + name, stat = lstatSync(path)
    if (stat.isSymbolicLink()) result[key] = 'link:' + readlinkSync(path)
    else if (stat.isDirectory()) Object.assign(result, tree(path, key))
    else if (stat.isFile()) result[key] = sha(path)
    else throw new Error('Unsupported package file: ' + key)
  }
  return result
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b) }
function json(file) { return JSON.parse(readFileSync(file, 'utf8')) }
function atomic(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = file + '.' + randomUUID() + '.tmp', fd = openSync(tmp, 'wx', 0o600)
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmp, file)
}
function command(exe, args) {
  const r = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  if (r.error || r.status !== 0) throw new Error(`${exe} failed: ${r.error?.message ?? r.stderr}`)
  return r.stdout.trim()
}
function regularApp(app) {
  if (lstatSync(app).isSymbolicLink()) throw new Error('Refusing symbolic application destination')
  if (!lstatSync(join(app, 'Contents/Resources/app.asar')).isFile() || lstatSync(join(app, 'Contents/Resources/app.asar')).isSymbolicLink()) throw new Error('Application archive must be a regular file')
}
export function appInfo(app) {
  regularApp(app)
  const info = JSON.parse(command('plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')]))
  if (info.CFBundleIdentifier !== 'ai.deepseek.dsh.desktop.next') throw new Error('Not the official DSH NEXT bundle identity')
  return { version: info.CFBundleShortVersionString, executable: join(app, 'Contents/MacOS', info.CFBundleExecutable), bundleId: info.CFBundleIdentifier }
}
export function validateApp(app) {
  const info = appInfo(app)
  command('codesign', ['--verify', '--deep', '--strict', app])
  const code = member(join(app, 'Contents/Resources/app.asar'), 'lib/main.js').toString()
  for (const marker of ['desktop-windows.json', 'WindowControlServer', 'persist:dsh-next-window-']) if (!code.includes(marker)) throw new Error('Required native window feature missing: ' + marker)
  return info
}
export function runningApp(app) {
  return command('ps', ['-axo', 'pid=,comm=']).split('\n').filter(line => {
    const path = line.trim().replace(/^\d+\s+/, '')
    return path.startsWith(app + '/')
  })
}
function closed(app, running) { if (running(app).length) throw new Error('DSH_RUNNING: close this DSH NEXT normally, then rerun; no process was terminated') }
function copyApp(source, destination) {
  if (existsSync(destination)) throw new Error('Copy destination already exists')
  if (process.platform === 'darwin') command('cp', ['-cR', source, destination])
  else cpSync(source, destination, { recursive: true, dereference: false, errorOnExist: true, force: false })
}
function protectedState(home) {
  const files = ['desktop-windows.json', 'desktop-preferences.json', 'desktop-locale.json', 'desktop-next-location.json']
  const result = {}
  for (const name of files) { const p = join(home, name); result[name] = existsSync(p) ? sha(p) : null }
  const profiles = join(home, 'profiles')
  if (existsSync(profiles)) for (const profile of readdirSync(profiles).sort()) {
    if (!lstatSync(join(profiles, profile)).isDirectory()) continue
    for (const name of ['package.json', 'pnpm-lock.yaml', 'cordis.yml', 'cordis.patch.yml', 'compatibility.json', 'desktop-next.runtime.patch.json', 'desktop-next.cordis.patch.json']) {
      const p = join(profiles, profile, name)
      if (existsSync(p)) result['profiles/' + profile + '/' + name] = sha(p)
    }
  }
  return result
}
function within(child, parent) { const r = relative(parent, child); return r === '' || (!r.startsWith('..' + sep) && r !== '..' && !r.startsWith(sep)) }
export function manifestPackage(bundle, info) {
  const launcher = join(bundle, '升级与回滚.command')
  const manifest = { schema: 1, platform: 'darwin', ...info, files: tree(join(bundle, 'DSH NEXT.app')), tools: existsSync(join(bundle, 'tools')) ? tree(join(bundle, 'tools')) : {}, launcher: existsSync(launcher) ? sha(launcher) : null }
  atomic(join(bundle, 'package.json'), manifest); return manifest
}
export function verifyPackage(bundle) {
  const m = json(join(bundle, 'package.json'))
  if (m.schema !== 1 || m.platform !== 'darwin' || !Array.isArray(m.architectures) || !m.architectures.includes(process.arch)) throw new Error('Wrong upgrade package platform or architecture')
  if (!same(m.files, tree(join(bundle, 'DSH NEXT.app'))) || !same(m.tools, existsSync(join(bundle, 'tools')) ? tree(join(bundle, 'tools')) : {})) throw new Error('Package files changed: refuse installation')
  if (m.launcher && sha(join(bundle, '升级与回滚.command')) !== m.launcher) throw new Error('Package launcher changed')
  return m
}
function layout(options = {}) {
  if (process.platform !== 'darwin' && !options.validate) throw new Error('This installer supports Mac; no application was changed')
  const app = findApp(options), home = options.home ? resolve(options.home) : dataHome(options)
  const key = createHash('sha256').update(app).digest('hex').slice(0, 16)
  const state = resolve(options.state ?? join(homedir(), 'Library/Application Support/DSH NEXT Upgrades', key))
  regularApp(app)
  if (within(app, home) || within(home, app) || within(state, app) || within(state, home)) throw new Error('Application, upgrade state and DSH data must be separate directories')
  return { app, home, state, validate: options.validate ?? validateApp, running: options.running ?? runningApp, copy: options.copy ?? copyApp, fault: options.fault ?? (() => {}) }
}
function lock(state, work) {
  mkdirSync(state, { recursive: true, mode: 0o700 }); const file = join(state, 'lock')
  try { mkdirSync(file, { mode: 0o700 }) } catch { throw new Error('UPGRADE_LOCKED: another or interrupted transaction needs inspection; no lock was removed') }
  atomic(join(file, 'owner.json'), { schema: 1, purpose: 'dsh-next-upgrade', pid: process.pid })
  try { return work() } finally { rmSync(file, { recursive: true }) }
}
export function recover(receipt, options = {}) {
  const r = json(receipt), app = resolve(options.app ?? r.app), state = resolve(options.state ?? dirname(receipt))
  if (r.schema !== 1 || r.app !== app || resolve(receipt) !== join(state, r.id + '.json') || r.backup !== join(dirname(app), '.DSH-NEXT-backup-' + r.id + '.app')) throw new Error('Invalid interrupted transaction receipt')
  const running = options.running ?? runningApp; closed(app, running)
  const locked = join(state, 'lock')
  if (existsSync(locked)) {
    const owner = json(join(locked, 'owner.json'))
    if (owner.schema !== 1 || owner.purpose !== 'dsh-next-upgrade' || !Number.isSafeInteger(owner.pid)) throw new Error('Unrecognized lock; left intact')
    try { process.kill(owner.pid, 0); throw new Error('UPGRADE_LOCKED: transaction owner is still running') }
    catch (error) { if (error.code !== 'ESRCH') throw error }
    rmSync(locked, { recursive: true })
  }
  if (existsSync(app)) {
    if (same(tree(app), r.previous)) { r.phase = 'failed_original_retained'; atomic(receipt, r); return r }
    if (!same(tree(app), r.installed)) throw new Error('Application changed; interrupted transaction left untouched')
    r.phase = 'installed'; atomic(receipt, r)
    return rollback(receipt, { ...options, app, home: r.home, state })
  }
  return lock(state, () => {
    regularApp(r.backup)
    if (!same(tree(r.backup), r.previous)) throw new Error('Interrupted backup changed')
    if (!options.validate) command('codesign', ['--verify', '--deep', '--strict', r.backup])
    renameSync(r.backup, app); r.phase = 'failed_original_retained'; atomic(receipt, r); return r
  })
}
export function installPackage(bundle, options = {}) {
  bundle = resolve(bundle)
  const m = verifyPackage(bundle), x = layout(options); x.validate(join(bundle, 'DSH NEXT.app')); closed(x.app, x.running)
  return lock(x.state, () => {
    const before = protectedState(x.home), id = Date.now() + '-' + randomUUID(), parent = dirname(x.app)
    const stage = join(parent, '.DSH-NEXT-stage-' + id + '.app'), backup = join(parent, '.DSH-NEXT-backup-' + id + '.app')
    const file = join(x.state, id + '.json'), originalTree = tree(x.app)
    const r = { schema: 1, id, file, app: x.app, home: x.home, backup, stage, phase: 'preparing', previous: originalTree, installed: m.files, protectedBefore: before }
    atomic(file, r)
    let moved = false
    try {
      x.copy(join(bundle, 'DSH NEXT.app'), stage)
      if (!same(tree(stage), m.files)) throw new Error('Staged files changed')
      x.validate(stage); closed(x.app, x.running)
      if (!same(originalTree, tree(x.app)) || !same(before, protectedState(x.home))) throw new Error('Application or configuration changed during staging')
      r.phase = 'staged'; atomic(file, r)
      renameSync(x.app, backup); moved = true; r.phase = 'old_moved'; atomic(file, r); x.fault('old_moved')
      renameSync(stage, x.app); r.phase = 'switched'; atomic(file, r); x.fault('switched')
      if (!same(tree(x.app), m.files) || !same(before, protectedState(x.home))) throw new Error('Post-install verification failed')
      x.validate(x.app); r.phase = 'installed'; atomic(file, r); atomic(join(x.state, 'latest.json'), { receipt: file })
      return r
    } catch (error) {
      if (moved) {
        if (existsSync(x.app)) renameSync(x.app, join(parent, '.DSH-NEXT-failed-' + id + '.app'))
        renameSync(backup, x.app)
      }
      r.phase = 'failed_original_retained'; r.error = String(error.message); atomic(file, r); throw error
    }
  })
}
export function rollback(receipt, options = {}) {
  const r = json(receipt), x = layout({ ...options, app: options.app ?? r.app, home: options.home ?? r.home })
  if (r.schema !== 1 || r.app !== x.app || r.home !== x.home || !['installed', 'switched'].includes(r.phase)) throw new Error('Receipt does not match this application transaction')
  closed(x.app, x.running)
  return lock(x.state, () => {
    if (!same(tree(x.app), r.installed)) throw new Error('Application changed since this install; refusing rollback')
    regularApp(r.backup)
    if (!same(tree(r.backup), r.previous)) throw new Error('Backup changed; refusing rollback')
    // Original vendor/v1 apps need not contain the new features; only their signature is checked.
    if (!options.validate) command('codesign', ['--verify', '--deep', '--strict', r.backup])
    const before = protectedState(x.home), retired = join(dirname(x.app), '.DSH-NEXT-retired-' + r.id + '.app')
    renameSync(x.app, retired)
    try { renameSync(r.backup, x.app) } catch (error) { renameSync(retired, x.app); throw error }
    if (!same(before, protectedState(x.home))) throw new Error('User configuration changed during rollback; data was not overwritten')
    r.phase = 'rolled_back'; r.retired = retired; r.rolledBackAt = new Date().toISOString(); atomic(receipt, r); return r
  })
}
export function makePackage({ app, out, prepared }) {
  if (process.platform !== 'darwin') throw new Error('Build this Mac package on a Mac')
  app = findApp({ app }); out = resolve(out)
  if (existsSync(out)) throw new Error('Refusing an existing package directory')
  const info = appInfo(app); command('codesign', ['--verify', '--deep', '--strict', app])
  if (within(out, app)) throw new Error('Package output must be outside the application')
  let build
  if (prepared) {
    const state = json(join(prepared, 'upgrade.json'))
    if (state.state !== 'source_checks_passed_native_install_pending' || !state.checkedSources || !state.checkedModules || !state.checkedScripts) throw new Error('Prepared source lacks successful, hash-bound checks; run verify first')
    const source = join(prepared, 'source/dsh-desktop-next')
    if (json(join(source, 'package.json')).version !== info.version || !same(tree(join(source, 'src')), state.checkedSources) || !same(tree(join(source, 'lib')), state.checkedModules) || !same(tree(join(source, 'scripts')), state.checkedScripts)) throw new Error('Prepared source/build changed or vendor version differs')
    build = join(source, 'lib')
  } else validateApp(app)
  mkdirSync(out, { recursive: true, mode: 0o700 })
  const destination = join(out, 'DSH NEXT.app'); copyApp(app, destination)
  if (build) {
    const archive = join(destination, 'Contents/Resources/app.asar'), staged = archive + '.new'
    const integrity = overlay(archive, staged, build); renameSync(staged, archive)
    command('plutil', ['-replace', 'ElectronAsarIntegrity.Resources/app\\.asar.hash', '-string', integrity, join(destination, 'Contents/Info.plist')])
    const entitlements = spawnSync('codesign', ['-d', '--entitlements', ':-', app], { encoding: 'utf8' })
    if (entitlements.status !== 0 || !entitlements.stdout.includes('<plist')) throw new Error('Original entitlements unavailable')
    const path = join(out, 'original-entitlements.plist'); writeFileSync(path, entitlements.stdout, { mode: 0o600 })
    command('codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', path, destination])
  }
  validateApp(destination)
  const tools = join(out, 'tools'); mkdirSync(tools)
  for (const name of ['portable-upgrade.mjs', 'portable-asar.mjs', 'window-locations.mjs', 'upgrade-cli.mjs', 'dsh-window.mjs', 'preserve-window-upgrade.mjs', 'run-upgrade.command']) {
    cpSync(join(scripts, name), join(tools, name)); if (name.endsWith('.command')) chmodSync(join(tools, name), 0o755)
  }
  cpSync(join(scripts, 'run-upgrade.command'), join(out, '升级与回滚.command')); chmodSync(join(out, '升级与回滚.command'), 0o755)
  const readme = join(scripts, '../PORTABLE-UPGRADE.md')
  if (existsSync(readme)) cpSync(readme, join(out, '使用说明.md'))
  const architectures = command('lipo', ['-archs', info.executable]).split(/\s+/).map(x => x === 'x86_64' ? 'x64' : x)
  const manifest = manifestPackage(out, { version: info.version, architectures, createdAt: new Date().toISOString(), feature: 'independent-windows-task-binding-v1', userDataIncluded: false })
  return { directory: out, version: manifest.version, architectures, files: Object.keys(manifest.files).length }
}
export function installTools(bundle, app, userHome = homedir()) {
  const m = verifyPackage(bundle), tools = join(bundle, 'tools'); if (!Object.keys(m.tools).length) throw new Error('Tools missing')
  const key = createHash('sha256').update(JSON.stringify(m.tools)).digest('hex').slice(0, 16)
  const base = join(userHome, '.local/share/dsh-next-upgrade'), version = join(base, key), bin = join(userHome, '.local/bin')
  mkdirSync(base, { recursive: true, mode: 0o700 }); mkdirSync(bin, { recursive: true })
  if (!existsSync(version)) cpSync(tools, version, { recursive: true, dereference: false })
  if (!same(tree(version), m.tools)) throw new Error('Installed tool version changed')
  atomic(join(base, 'installation.json'), { app: resolve(app), toolVersion: key })
  for (const [name, entry] of [['dsh-next-upgrade', 'upgrade-cli.mjs'], ['dsh-window', 'dsh-window.mjs']]) {
    // A fixed user-relative launcher works for different user names and custom application paths.
    const script = '#!/bin/sh\nexec "$HOME/.local/share/dsh-next-upgrade/' + key + '/run-upgrade.command" --entry ' + entry + ' "$@"\n'
    writeFileSync(join(bin, name), script, { mode: 0o755 }); chmodSync(join(bin, name), 0o755)
  }
  return { bin, version, app }
}
