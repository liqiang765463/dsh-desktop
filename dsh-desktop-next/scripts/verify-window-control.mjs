/** Two independent calling processes against the isolated native app, never a business Profile. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
if (!process.env.DSH_WINDOW_HOME || !process.env.DSH_WINDOW_HOME.includes('smoke-home')) throw new Error('This smoke must explicitly target the isolated smoke-home')
const cli = fileURLToPath(new URL('./dsh-window.mjs', import.meta.url))
const actors = ['01a17ce1-26d0-7171-986d-5783ba43923a', '01a17ce1-26d0-7171-986d-5783ba43923b']
function invoke(actor, args, input, expectedError) {
  const result = spawnSync(process.execPath, [cli, ...args], { env: { ...process.env, CODEX_THREAD_ID: actor }, input, encoding: 'utf8' })
  if (expectedError) { assert.notEqual(result.status, 0); assert.match(result.stderr, new RegExp(expectedError)); return result.stderr.trim() }
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
const one = invoke(actors[0], ['bind']), two = invoke(actors[1], ['bind'])
assert.notEqual(one.windowId, two.windowId)
const snapshot = actor => invoke(actor, ['snapshot'])
const click = (actor, snap, label) => {
  const target = snap.nodes.find(node => node.name === label)
  assert(target, `Observed control not found: ${label}`)
  return invoke(actor, ['click', String(target.id), '--snapshot', snap.snapshot, '--window', snap.windowId])
}
let a = snapshot(actors[0]), b = snapshot(actors[1])
click(actors[0], a, '自动化任务')
click(actors[1], b, '插件')
a = snapshot(actors[0]); b = snapshot(actors[1])
assert.match(a.text, /任务状态|还没有自动化任务/u); assert.match(b.text, /安装、启用和配置插件|插件市场/u)
const denied = invoke(actors[0], ['click', String(b.nodes[0].id), '--window', two.windowId, '--snapshot', b.snapshot], undefined, 'CROSS_WINDOW_DENIED')
const stale = invoke(actors[0], ['click', String(b.nodes[0].id), '--snapshot', b.snapshot], undefined, 'STALE_SNAPSHOT')
const afterA = snapshot(actors[0]), afterB = snapshot(actors[1])
assert.match(afterA.text, /任务状态|还没有自动化任务/u); assert.match(afterB.text, /安装、启用和配置插件|插件市场/u)
assert.equal(invoke(actors[0], ['status']).windowId, one.windowId)
click(actors[0], afterA, '新建会话'); click(actors[1], afterB, '新建会话')
for (const [index, actor] of actors.entries()) {
  const snap = snapshot(actor), editor = snap.nodes.find(node => node.role === 'textbox')
  assert(editor, 'The native composer must be observed')
  invoke(actor, ['fill', String(editor.id), '--snapshot', snap.snapshot, '--window', snap.windowId], `BOUND_WINDOW_${index + 1}_UNSENT_DRAFT`)
}
const draftA = snapshot(actors[0]), draftB = snapshot(actors[1])
assert.match(draftA.text, /BOUND_WINDOW_1_UNSENT_DRAFT/u); assert.doesNotMatch(draftA.text, /BOUND_WINDOW_2_UNSENT_DRAFT/u)
assert.match(draftB.text, /BOUND_WINDOW_2_UNSENT_DRAFT/u); assert.doesNotMatch(draftB.text, /BOUND_WINDOW_1_UNSENT_DRAFT/u)
click(actors[0], draftA, '自动化任务'); click(actors[1], draftB, '插件')
console.log(JSON.stringify({ pass: true, one, two, pages: ['automation', 'plugins'], denied, stale,
  independentDrafts: true,
  focusBefore: [a.focused, b.focused], focusAfter: [afterA.focused, afterB.focused],
  note: 'Two CLI caller processes, not two independently running AI models. No model message or business workflow save.' }, null, 2))
