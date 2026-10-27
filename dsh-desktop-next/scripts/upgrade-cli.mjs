#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dataHome, findApp } from './window-locations.mjs'
import { appInfo, runningApp, makePackage, installPackage, rollback, recover, installTools, verifyPackage } from './portable-upgrade.mjs'

export function main(argv = process.argv.slice(2)) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22+ or the DSH bundled Electron Node runtime is required')
  const args = [...argv], mode = args.shift() ?? 'doctor', flags = {}, positional = []
  while (args.length) {
    const value = args.shift()
    if (!value.startsWith('--')) { positional.push(value); continue }
    if (!['--app', '--home', '--out', '--prepared', '--source', '--receipt'].includes(value) || !args.length) throw new Error('Unknown or incomplete argument: ' + value)
    flags[value.slice(2)] = args.shift()
  }
  if (['prepare', 'verify', 'export'].includes(mode)) {
    const source = resolve(flags.source ?? join(dirname(fileURLToPath(import.meta.url)), '../..'))
    const script = join(source, 'dsh-desktop-next/scripts/preserve-window-upgrade.mjs')
    if (!existsSync(join(source, '.git')) || !existsSync(script)) throw new Error('Preparing source requires the reviewed feature repository; specify --source REPOSITORY. Installing a prepared package does not require it.')
    const r = spawnSync(process.execPath, [script, mode, ...positional], { stdio: 'inherit', cwd: source })
    if (r.error) throw r.error
    process.exitCode = r.status ?? 1; return
  }
  if (mode === 'package') {
    if (!flags.out || positional.length) throw new Error('package --app DSH_NEXT_APP --out NEW_DIRECTORY [--prepared CHECKED_UPGRADE]')
    console.log(JSON.stringify(makePackage(flags), null, 2)); return
  }
  if (mode === 'recover') {
    if (!flags.receipt) throw new Error('recover --receipt INTERRUPTED_TRANSACTION_JSON')
    console.log(JSON.stringify(recover(resolve(flags.receipt)), null, 2)); return
  }
  const app = findApp(flags), home = flags.home ? resolve(flags.home) : dataHome()
  const key = createHash('sha256').update(app).digest('hex').slice(0, 16)
  const state = join(homedir(), 'Library/Application Support/DSH NEXT Upgrades', key)
  if (mode === 'doctor') {
    console.log(JSON.stringify({ app, ...appInfo(app), home, running: runningApp(app).length > 0, state, dataWillBeModified: false }, null, 2)); return
  }
  if (mode === 'install') {
    if (positional.length !== 1) throw new Error('install PACKAGE_DIRECTORY [--app APPLICATION]')
    const bundle = resolve(positional[0]); verifyPackage(bundle)
    const receipt = installPackage(bundle, { app, home, state })
    const tools = installTools(bundle, app)
    console.log(JSON.stringify({ installed: true, receipt: receipt.file, rollback: 'dsh-next-upgrade rollback --receipt ' + receipt.file, tools, originalDataRetained: true }, null, 2)); return
  }
  if (mode === 'tools') {
    if (positional.length !== 1) throw new Error('tools PACKAGE_DIRECTORY [--app APPLICATION]')
    console.log(JSON.stringify(installTools(resolve(positional[0]), app), null, 2)); return
  }
  if (mode === 'rollback') {
    const receipt = flags.receipt ?? JSON.parse(readFileSync(join(state, 'latest.json'), 'utf8')).receipt
    console.log(JSON.stringify(rollback(resolve(receipt), { app, home, state }), null, 2)); return
  }
  throw new Error('Use doctor | prepare latest OUT --source REPO | verify OUT --source REPO | package --out DIR | install DIR | tools DIR | rollback [--receipt FILE] | recover --receipt FILE')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
