/** Native application windows share a Host, but never an IPC sender or Chromium storage partition. */
import { APP_URL } from './ipc.ts'

interface AppWindow {
  isDestroyed(): boolean
  isFocused(): boolean
  webContents: { id: number; mainFrame: { url: string } }
}

/** Process-owned membership; renderer-provided window ids cannot grant access. */
export class ApplicationWindows<T extends AppWindow> {
  private readonly slots = new Map<T, number>()
  get all(): T[] { return [...this.slots.keys()].filter(window => !window.isDestroyed()) }
  nextSlot(): number { const used = new Set(this.slots.values()); let slot = 0; while (used.has(slot)) slot++; return slot }
  add(window: T, slot: number): void { this.slots.set(window, slot) }
  delete(window: T): void { this.slots.delete(window) }
  active(): T | undefined { return this.all.find(window => window.isFocused()) ?? this.all[0] }
  fromContents(id: number | undefined): T | undefined { return this.all.find(window => window.webContents.id === id) }
  /** Accept only a registered window's live application main frame. */
  owner(event: { sender: unknown; senderFrame: unknown }): T {
    const window = this.all.find(candidate => candidate.webContents === event.sender)
    if (!window || event.senderFrame !== window.webContents.mainFrame || !window.webContents.mainFrame.url.startsWith(APP_URL)) {
      throw new Error('Rejected Next IPC sender')
    }
    return window
  }
}
