/** Durable window identity and Codex-thread ownership, separate from temporary native slots. */
import { randomUUID } from 'node:crypto'
import { atomicJson, readPrivateFile } from './private-files.ts'

export interface WindowIdentity { id: string; slot: number; owner?: string }
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u
export function threadId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('A real CODEX_THREAD_ID is required')
  return value
}
export class WindowIdentities {
  private records: WindowIdentity[]
  constructor(private readonly file: string) {
    const raw = readPrivateFile(file)
    if (raw === undefined) this.records = []
    else {
      const state = JSON.parse(raw)
      if (state.version !== 1 || !Array.isArray(state.windows)) throw new Error('Invalid window identity store')
      const ids = new Set(), slots = new Set(), owners = new Set()
      for (const row of state.windows) {
        if (!row || !uuid.test(row.id) || !Number.isSafeInteger(row.slot) || row.slot < 0 || ids.has(row.id) || slots.has(row.slot)
          || row.owner !== undefined && (threadId(row.owner) === '' || owners.has(row.owner))) throw new Error('Invalid or duplicate window identity')
        ids.add(row.id); slots.add(row.slot); if (row.owner !== undefined) owners.add(row.owner)
      }
      this.records = state.windows
    }
  }
  get all(): WindowIdentity[] { return this.records.map(row => ({ ...row })) }
  private save(): void { atomicJson(this.file, { version: 1, windows: this.records }) }
  create(): WindowIdentity {
    const row = { id: randomUUID(), slot: Math.max(-1, ...this.records.map(row => row.slot)) + 1 }
    this.records.push(row); this.save(); return { ...row }
  }
  first(): WindowIdentity { return this.all[0] ?? this.create() }
  find(id: string): WindowIdentity | undefined { return this.all.find(row => row.id === id) }
  claim(ownerValue: unknown, requestedId?: unknown): WindowIdentity {
    const owner = threadId(ownerValue)
    let row = this.records.find(row => row.owner === owner)
    if (row) {
      if (requestedId !== undefined && requestedId !== row.id) throw new Error('CROSS_WINDOW_DENIED: this Codex task already owns another window')
      return { ...row }
    }
    if (requestedId !== undefined) {
      if (typeof requestedId !== 'string') throw new Error('Invalid window ID')
      row = this.records.find(row => row.id === requestedId)
      if (!row || row.owner !== undefined) throw new Error('CROSS_WINDOW_DENIED: requested window is unavailable or owned')
    } else row = this.records.find(row => row.owner === undefined)
    if (!row) { this.create(); row = this.records.at(-1)! }
    row.owner = owner; this.save(); return { ...row }
  }
  owned(ownerValue: unknown, expected?: unknown): WindowIdentity {
    const owner = threadId(ownerValue), row = this.records.find(row => row.owner === owner)
    if (!row) throw new Error('NOT_BOUND: run dsh-window bind first')
    if (expected !== undefined && expected !== row.id) throw new Error('CROSS_WINDOW_DENIED: operation does not target this task window')
    return { ...row }
  }
}
