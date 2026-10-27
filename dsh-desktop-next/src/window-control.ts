/** Local, owner-bound DSH control transport; no network listener or global desktop input. */
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chmodSync, lstatSync, rmSync } from 'node:fs'
import { createConnection, createServer, type Server } from 'node:net'
import type { WindowIdentity, WindowIdentities } from './window-identities.ts'
import { windowPage } from './window-page.ts'

export interface ControlledWindow {
  isDestroyed(): boolean
  isFocused?(): boolean
  webContents: { executeJavaScript(code: string): Promise<any>; capturePage(): Promise<{ toPNG(): Buffer }> }
}
type Observation = { id: string; documentId: string }
export function windowControlPath(home: string): string {
  return join(homedir(), '.dsh-next-window-control', createHash('sha256').update(home).digest('hex').slice(0, 16), 'control.sock')
}
export class WindowControl {
  private observations = new Map<string, Observation>()
  private queues = new Map<string, Promise<unknown>>()
  constructor(private readonly identities: WindowIdentities, private readonly open: (row: WindowIdentity) => ControlledWindow,
    private readonly changed: (row: WindowIdentity) => void = () => {}) {}
  request(value: unknown): Promise<unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return Promise.reject(new Error('Invalid control request'))
    const input = value as Record<string, any>
    const key = typeof input.owner === 'string' ? input.owner : ''
    const work = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => this.perform(input))
    this.queues.set(key, work)
    void work.finally(() => { if (this.queues.get(key) === work) this.queues.delete(key) }).catch(() => {})
    return work
  }
  private async perform(input: Record<string, any>): Promise<unknown> {
    const row = input.action === 'bind' ? this.identities.claim(input.owner, input.windowId) : this.identities.owned(input.owner, input.windowId)
    if (input.action === 'bind') { this.open(row); this.changed(row); return { windowId: row.id, label: `窗口 ${row.slot + 1}`, owner: row.owner } }
    if (input.action === 'status') return { windowId: row.id, owner: row.owner, label: `窗口 ${row.slot + 1}` }
    if (!['snapshot', 'click', 'fill', 'select', 'scroll', 'capture'].includes(input.action)) throw new Error('UNSUPPORTED_ACTION')
    const window = this.open(row)
    if (window.isDestroyed()) throw new Error('WINDOW_CLOSED: bind again; another window is never substituted')
    if (input.action === 'capture') {
      return { windowId: row.id, png: (await window.webContents.capturePage()).toPNG().toString('base64') }
    }
    const prefix = { windowId: row.id, owner: row.owner, focused: window.isFocused?.() ?? null }
    if (input.action === 'snapshot') {
      const id = randomUUID()
      const page = await window.webContents.executeJavaScript(`(${windowPage.toString()})(${JSON.stringify({ action: 'snapshot', observation: id })})`)
      this.observations.set(row.id, { id, documentId: page.documentId })
      return { ...prefix, snapshot: id, ...page }
    }
    const observed = this.observations.get(row.id)
    if (!observed || observed.id !== input.snapshot) throw new Error('STALE_SNAPSHOT: the snapshot must belong to this task and window')
    this.observations.delete(row.id)
    if (!Number.isSafeInteger(input.node) || input.node < 1) throw new Error('Invalid observed node')
    const payload = { action: input.action, node: input.node, text: input.text, value: input.value, y: input.y,
      observation: observed.id, documentId: observed.documentId }
    return { ...prefix, ...await window.webContents.executeJavaScript(`(${windowPage.toString()})(${JSON.stringify(payload)})`) }
  }
}

export class WindowControlServer {
  private server: Server | undefined
  constructor(private readonly path: string, private readonly control: WindowControl) {}
  async listen(): Promise<void> {
    const existing = lstatSync(this.path, { throwIfNoEntry: false })
    if (existing) {
      if (!existing.isSocket() || existing.isSymbolicLink()) throw new Error('Refusing linked or non-socket window control path')
      const occupied = await new Promise<boolean>(resolve => {
        const probe = createConnection(this.path)
        probe.once('connect', () => { probe.destroy(); resolve(true) }); probe.once('error', error => { probe.destroy(); if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') resolve(false); else resolve(true) })
      })
      if (occupied) throw new Error('Window control already has a live owner')
      rmSync(this.path)
    }
    const server = this.server = createServer(socket => {
      let text = '', used = false
      socket.setTimeout(30_000, () => socket.destroy())
      socket.setEncoding('utf8')
      socket.on('error', () => {})
      socket.on('data', chunk => {
        if (used) return
        text += chunk
        if (Buffer.byteLength(text) > 256 * 1024) { used = true; socket.end(JSON.stringify({ ok: false, error: 'Request too large' }) + '\n'); return }
        if (!text.includes('\n')) return
        used = true
        void Promise.resolve().then(() => JSON.parse(text.slice(0, text.indexOf('\n')))).then(value => this.control.request(value))
          .then(value => socket.end(JSON.stringify({ ok: true, value }) + '\n'), error => socket.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) + '\n'))
      })
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(this.path, () => { chmodSync(this.path, 0o600); resolve() }) })
  }
  close(): void { this.server?.close(); this.server = undefined }
}
