import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { WindowIdentities } from '../src/window-identities.ts'
const a = '01a17ce1-26d0-7171-986d-5783ba43923a', b = '01a17ce1-26d0-7171-986d-5783ba43923b'
it('persists identities and exclusive task bindings across process restarts without slot reuse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-window-identity-')), file = join(dir, 'windows.json')
  try {
    const first = new WindowIdentities(file), one = first.first(), two = first.create()
    expect(first.claim(a)).toEqual({ ...one, owner: a })
    expect(first.claim(b)).toEqual({ ...two, owner: b })
    const restored = new WindowIdentities(file)
    expect(restored.claim(a).id).toBe(one.id)
    expect(restored.claim(b).id).toBe(two.id)
    expect(restored.create().slot).toBe(2)
    expect(() => restored.claim(a, two.id)).toThrow('CROSS_WINDOW_DENIED')
    expect(() => restored.owned(a, two.id)).toThrow('CROSS_WINDOW_DENIED')
    expect(() => restored.claim('01a17ce1-26d0-7171-986d-5783ba43923c', two.id)).toThrow('CROSS_WINDOW_DENIED')
    expect(() => restored.claim('AI A')).toThrow('CODEX_THREAD_ID')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
it('refuses corrupted state instead of reassigning another task window', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-window-identity-')), file = join(dir, 'windows.json')
  try {
    writeFileSync(file, JSON.stringify({ version: 1, windows: [{ id: a, slot: 0, owner: b }, { id: a, slot: 1 }] }))
    expect(() => new WindowIdentities(file)).toThrow('duplicate')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
