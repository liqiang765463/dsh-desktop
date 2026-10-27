#!/usr/bin/env node
/** Codex exec supplies the task identity. No --owner, process environment dump or app-wide input. */
import { createHash } from 'node:crypto'
import { createConnection } from 'node:net'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { dataHome } from './window-locations.mjs'

const actor = process.env.CODEX_THREAD_ID
if (!actor || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(actor)) {
  console.error('CODEX_THREAD_ID is missing. Run this tool from the owning Codex task; do not borrow another task identity.'); process.exit(2)
}
const args = process.argv.slice(2), action = args.shift() ?? 'status'
if (!['bind', 'status', 'snapshot', 'click', 'fill', 'select', 'scroll', 'capture'].includes(action)) {
  console.error('Usage: dsh-window bind|status|snapshot|click NODE|fill NODE|select NODE VALUE|scroll NODE Y|capture [--out PATH] [--snapshot ID] [--window ID]'); process.exit(2)
}
const request = { action, owner: actor }
let output
if (['click', 'fill', 'select', 'scroll'].includes(action)) request.node = Number(args.shift())
if (action === 'select') request.value = args.shift()
if (action === 'scroll') request.y = Number(args.shift())
while (args.length) {
  const option = args.shift(), value = args.shift()
  if (!value || !['--window', '--snapshot', '--out'].includes(option)) { console.error('Unknown or incomplete option'); process.exit(2) }
  if (option === '--window') request.windowId = value
  if (option === '--snapshot') request.snapshot = value
  if (option === '--out') output = resolve(value)
}
if (action === 'fill') {
  request.text = readFileSync(0, 'utf8') // No draft text in process arguments or clipboard.
  if (Buffer.byteLength(request.text) > 100_000) throw new Error('Input is too large')
}
const home = dataHome()
const socketPath = join(homedir(), '.dsh-next-window-control', createHash('sha256').update(home).digest('hex').slice(0, 16), 'control.sock')
const response = await new Promise((resolveResult, reject) => {
  let body = ''
  const socket = createConnection(socketPath)
  socket.setEncoding('utf8'); socket.setTimeout(30_000, () => socket.destroy(new Error('Window operation timed out; do not replay an uncertain action')))
  socket.once('connect', () => socket.write(JSON.stringify(request) + '\n'))
  socket.on('data', chunk => {
    body += chunk
    if (body.length > 30 * 1024 * 1024) { socket.destroy(new Error('Response is too large')); return }
    if (!body.includes('\n')) return
    try { const result = JSON.parse(body.slice(0, body.indexOf('\n'))); socket.end(); resolveResult(result) } catch (error) { socket.destroy(); reject(error) }
  })
  socket.once('error', reject)
  socket.once('end', () => { if (!body.includes('\n')) reject(new Error('Window control connection ended without a result')) })
}).catch(error => {
  console.error('DSH_WINDOW_UNAVAILABLE: ' + error.message + '. Keep the same task binding; do not fall back to app-wide Computer Use.'); process.exit(1)
})
if (!response.ok) { console.error(JSON.stringify(response)); process.exitCode = 1 }
else if (action === 'capture') {
  output ??= join(homedir(), '.codex', 'dsh-window-captures', actor, 'window.png')
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 }); writeFileSync(output, Buffer.from(response.value.png, 'base64'), { mode: 0o600 })
  console.log(JSON.stringify({ windowId: response.value.windowId, path: output }))
} else console.log(JSON.stringify(response.value))
