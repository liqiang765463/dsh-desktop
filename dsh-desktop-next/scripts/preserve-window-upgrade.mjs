#!/usr/bin/env node
/** Export the feature diff and rehearse a forward-port in an isolated source checkout. Never installs. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const base = '6a63b9730b82cf4e858b9a11ac9783da9a5a0c3a'
function run(command, args, cwd = repo, input) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', input, maxBuffer: 20 * 1024 * 1024 })
  if (result.error) throw result.error
  return result
}
function checked(command, args, cwd = repo, input) {
  const result = run(command, args, cwd, input)
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`)
  return result.stdout.trim()
}
const [mode = 'export', ...args] = process.argv.slice(2)
if (!['export', 'prepare'].includes(mode)) throw new Error('Usage: dsh-next-upgrade export OUT | prepare REF OUT')
let target = mode === 'prepare' ? args.shift() : undefined
const out = resolve(args.shift() ?? join(repo, '../window-upgrade-' + Date.now()))
if (args.length || !target && mode === 'prepare') throw new Error('An exact upstream ref and a new output directory are required')
if (existsSync(out)) throw new Error('Refusing an existing output directory')
if (checked('git', ['status', '--porcelain', '--untracked-files=normal'])) throw new Error('Commit the feature changes first; upgrades must export an exact reviewed source revision')
const feature = checked('git', ['rev-parse', 'HEAD'])
const patch = run('git', ['diff', '--binary', base, feature, '--', 'dsh-desktop-next', '.agents/notes/implemented/desktop']).stdout
if (!patch.includes('window-identities.ts') || !patch.includes('window-control.ts') || !patch.includes('dsh-window.mjs')) throw new Error('Feature patch is incomplete')
mkdirSync(out, { recursive: true, mode: 0o700 })
writeFileSync(join(out, 'windows.patch'), patch)
const manifest = { version: 1, base, feature, patchSha256: createHash('sha256').update(patch).digest('hex'),
  target: target ?? null, state: 'exported', installed: false, dataMigration: 'none; desktop-windows.json and window partitions stay in the existing user data directory' }
const save = () => writeFileSync(join(out, 'upgrade.json'), JSON.stringify(manifest, null, 2) + '\n')
save()
if (mode === 'export') { console.log(JSON.stringify({ directory: out, ...manifest })); process.exit(0) }
if (target === 'latest') {
  const release = JSON.parse(checked('gh', ['release', 'view', '--repo', 'anywhere-labs/dsh-desktop', '--json', 'tagName,isPrerelease']))
  if (release.isPrerelease) throw new Error('Refusing a prerelease upgrade target')
  target = release.tagName; manifest.target = target; save()
}
if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,150}$/u.test(target) || target.includes('..')) throw new Error('Invalid upstream ref')
// Only the official upstream is fetched. This does not change the working branch or installed app.
if (run('git', ['rev-parse', '--verify', `${target}^{commit}`]).status !== 0) checked('git', ['fetch', '--no-tags', 'https://github.com/anywhere-labs/dsh-desktop.git', `refs/tags/${target}:refs/tags/${target}`])
manifest.targetRevision = checked('git', ['rev-parse', `${target}^{commit}`]); save()
const checkout = join(out, 'source')
checked('git', ['clone', '--shared', '--no-checkout', repo, checkout])
checked('git', ['checkout', '--detach', manifest.targetRevision], checkout)
const merge = run('git', ['apply', '--3way', '--index', join(out, 'windows.patch')], checkout)
writeFileSync(join(out, 'merge.log'), merge.stdout + merge.stderr)
if (merge.status !== 0) {
  manifest.state = 'needs_source_merge'; save()
  console.log(JSON.stringify({ directory: out, ...manifest, explanation: 'Upstream changed the same source. Review conflicts in this isolated checkout; the current application is untouched.' }))
  process.exit(3)
}
manifest.state = 'merged_requires_checks'; save()
// Reuse dependencies only when upstream declared exactly the same versions. No hidden package updates.
for (const file of ['package.json', 'yarn.lock', 'dsh-desktop-next/package.json']) {
  const current = readFileSync(join(checkout, file), 'utf8'), original = run('git', ['show', `${base}:${file}`]).stdout
  const dependencyView = text => {
    if (!file.endsWith('.json')) return text
    const value = JSON.parse(text)
    return JSON.stringify(Object.fromEntries(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'resolutions', 'packageManager', 'engines'].map(key => [key, value[key]])))
  }
  if (dependencyView(current) !== dependencyView(original)) {
    manifest.state = 'merged_requires_dependency_review'; manifest.dependencyChange = file; save()
    console.log(JSON.stringify({ directory: out, ...manifest })); process.exit(4)
  }
}
for (const relative of ['node_modules', 'dsh-desktop-next/node_modules']) {
  if (existsSync(join(repo, relative))) symlinkSync(join(repo, relative), join(checkout, relative), 'dir')
}
const test = run(process.execPath, [join(repo, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts',
  'tests/window-identities.spec.ts', 'tests/window-control.spec.ts', 'tests/app-windows.spec.ts', 'tests/main-lifecycle.spec.ts',
  'tests/keyboard.spec.ts', 'tests/native-notifications.spec.ts', 'tests/web-document.spec.ts', 'tests/app-downloads.spec.ts', 'tests/electron-permissions.spec.ts'], join(checkout, 'dsh-desktop-next'))
writeFileSync(join(out, 'tests.log'), test.stdout + test.stderr)
if (test.status !== 0) { manifest.state = 'check_failed'; save(); console.log(JSON.stringify({ directory: out, ...manifest })); process.exit(5) }
const build = run(process.execPath, [join(repo, 'node_modules/tsdown/dist/run.mjs'), '--cwd', 'dsh-desktop-next'], checkout)
writeFileSync(join(out, 'build.log'), build.stdout + build.stderr)
manifest.state = build.status === 0 ? 'source_checks_passed_native_install_pending' : 'build_failed'; save()
console.log(JSON.stringify({ directory: out, ...manifest }))
process.exitCode = build.status === 0 ? 0 : 6
