/** Native smoke through the actual owning Codex task; never override a task identity. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
if (!process.env.DSH_WINDOW_HOME || !process.env.DSH_WINDOW_HOME.includes('smoke-home')) throw new Error('This smoke must explicitly target the isolated smoke-home')
if (!process.env.CODEX_THREAD_ID) throw new Error('Run from the actual owning Codex task')
const cli = fileURLToPath(new URL('./dsh-window.mjs', import.meta.url))
function invoke(args, input, expectedError) {
  const result = spawnSync(process.execPath, [cli, ...args], { env: process.env, input, encoding: 'utf8' })
  if (expectedError) { assert.notEqual(result.status, 0); assert.match(result.stderr, new RegExp(expectedError)); return result.stderr.trim() }
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
const binding = invoke(['bind'])
let snap = invoke(['snapshot'])
const click = label => {
  const target = snap.nodes.find(node => node.name === label)
  assert(target, `Observed control not found: ${label}`)
  invoke(['click', String(target.id), '--snapshot', snap.snapshot, '--window', binding.windowId])
  snap = invoke(['snapshot'])
}
click('自动化任务'); assert.match(snap.text, /任务状态|还没有自动化任务/u)
const denied = invoke(['click', '1', '--window', randomUUID(), '--snapshot', snap.snapshot], undefined, 'CROSS_WINDOW_DENIED')
const stale = invoke(['click', '1', '--snapshot', randomUUID()], undefined, 'STALE_SNAPSHOT')
click('新建会话')
const editor = snap.nodes.find(node => node.role === 'textbox'); assert(editor)
invoke(['fill', String(editor.id), '--snapshot', snap.snapshot], 'OWN_WINDOW_UNSENT_DRAFT')
snap = invoke(['snapshot']); assert.match(snap.text, /OWN_WINDOW_UNSENT_DRAFT/u)
click('插件'); assert.match(snap.text, /插件市场/u)
assert.equal(invoke(['bind']).windowId, binding.windowId)
console.log(JSON.stringify({ pass: true, binding, denied, stale, draftInput: true, focused: snap.focused,
  note: 'Actual current Codex identity only. No model message or workflow save; synthetic multi-owner routing belongs to headless tests.' }, null, 2))
