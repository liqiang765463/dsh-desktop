import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { expect, it, vi } from 'vitest'
import { WindowIdentities } from '../src/window-identities.ts'
import { WindowControl, WindowControlServer } from '../src/window-control.ts'
const a = '01a17ce1-26d0-7171-986d-5783ba43923a', b = '01a17ce1-26d0-7171-986d-5783ba43923b'
it('routes interleaved callers directly to their own windows and rejects cross-window or borrowed observations before dispatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bound-'))
  try {
    const identities = new WindowIdentities(join(dir, 'windows.json'))
    const windows = new Map<string, any>()
    const open = vi.fn(row => {
      if (!windows.has(row.id)) windows.set(row.id, { isDestroyed: () => false, webContents: {
        executeJavaScript: vi.fn(async code => code.includes('"action":"snapshot"') ? { documentId: row.id, nodes: [] } : { dispatched: true }),
      } })
      return windows.get(row.id)
    })
    const control = new WindowControl(identities, open)
    const one: any = await control.request({ action: 'bind', owner: a }), two: any = await control.request({ action: 'bind', owner: b })
    expect(one.windowId).not.toBe(two.windowId)
    const [snapA, snapB]: any[] = await Promise.all([control.request({ action: 'snapshot', owner: a }), control.request({ action: 'snapshot', owner: b })])
    expect(snapA.windowId).toBe(one.windowId); expect(snapB.windowId).toBe(two.windowId)
    const before = open.mock.calls.length
    await expect(control.request({ action: 'click', owner: a, windowId: two.windowId, snapshot: snapB.snapshot, node: 1 })).rejects.toThrow('CROSS_WINDOW_DENIED')
    await expect(control.request({ action: 'click', owner: a, snapshot: snapB.snapshot, node: 1 })).rejects.toThrow('STALE_SNAPSHOT')
    expect(open).toHaveBeenCalledTimes(before + 1) // Own-window lookup only; cross-window ID is rejected before it.
    expect(windows.get(two.windowId).webContents.executeJavaScript).toHaveBeenCalledTimes(1)
    await control.request({ action: 'fill', owner: a, snapshot: snapA.snapshot, node: 1, text: 'A draft' })
    expect(windows.get(one.windowId).webContents.executeJavaScript).toHaveBeenLastCalledWith(expect.stringContaining('A draft'))
    expect(windows.get(two.windowId).webContents.executeJavaScript).toHaveBeenCalledTimes(1)
    await expect(control.request({ action: 'fill', owner: a, snapshot: snapA.snapshot, node: 1, text: 'retry' })).rejects.toThrow('STALE_SNAPSHOT')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
it('serves bounded local requests and denies unbound operations without opening a window', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bound-socket-')), open = vi.fn()
  const server = new WindowControlServer(join(dir, 'control.sock'), new WindowControl(new WindowIdentities(join(dir, 'windows.json')), open))
  try {
    await server.listen()
    const reply = await new Promise<string>((resolve, reject) => {
      const connection = createConnection(join(dir, 'control.sock')); let text = ''
      connection.once('connect', () => connection.write(JSON.stringify({ owner: a, action: 'click', node: 1 }) + '\n'))
      connection.on('data', chunk => { text += chunk }); connection.once('end', () => resolve(text)); connection.once('error', reject)
    })
    expect(JSON.parse(reply).error).toContain('NOT_BOUND'); expect(open).not.toHaveBeenCalled()
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }) }
})
