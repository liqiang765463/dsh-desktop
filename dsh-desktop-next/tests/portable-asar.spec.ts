import { expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { header, member, overlay } from '../scripts/portable-asar.mjs'

it('overlays compiled modules while preserving unrelated vendor members and native unpack metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-asar-'))
  try {
    const vendor = join(root, 'old.asar'), destination = join(root, 'new.asar'), build = join(root, 'build')
    const raw = Buffer.from(JSON.stringify({ files: {
      'package.json': { offset: '0', size: 2 },
      lib: { files: { 'main.js': { offset: '2', size: 3 }, 'client.js': { offset: '5', size: 6 } } },
      'native.node': { size: 77, unpacked: true },
    } }))
    const payload = Math.ceil((4 + raw.length) / 4) * 4, prefix = Buffer.alloc(16)
    prefix.writeUInt32LE(4); prefix.writeUInt32LE(payload + 4, 4); prefix.writeUInt32LE(payload, 8); prefix.writeUInt32LE(raw.length, 12)
    writeFileSync(vendor, Buffer.concat([prefix, raw, Buffer.alloc(payload - 4 - raw.length), Buffer.from('{}oldclient')]))
    mkdirSync(build); writeFileSync(join(build, 'main.js'), 'new main'); writeFileSync(join(build, 'client.js'), 'do not replace vendor frontend')
    const hash = overlay(vendor, destination, build)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(member(destination, 'lib/main.js').toString()).toBe('new main')
    expect(member(destination, 'lib/client.js').toString()).toBe('client')
    expect(member(destination, 'package.json').toString()).toBe('{}')
    expect(header(destination).files['native.node']).toEqual({ size: 77, unpacked: true })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('rejects a truncated archive before reading arbitrary offsets', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-asar-invalid-'))
  try { const p = join(root, 'x'); writeFileSync(p, 'bad'); expect(() => header(p)).toThrow('Invalid ASAR') }
  finally { rmSync(root, { recursive: true, force: true }) }
})
