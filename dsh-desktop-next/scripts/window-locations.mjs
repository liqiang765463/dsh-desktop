/** Shared, user-independent Mac locations. No credentials or account state are read. */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export function dataHome({ userHome = homedir(), env = process.env } = {}) {
  if (env.DSH_WINDOW_HOME || env.DSH_DESKTOP_NEXT_HOME) return resolve(env.DSH_WINDOW_HOME || env.DSH_DESKTOP_NEXT_HOME)
  const file = join(userHome, 'Library/Application Support/DSH NEXT/home/desktop-next-location.json')
  if (!existsSync(file)) return join(userHome, '.dsh')
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (!value || typeof value.home !== 'string' || !isAbsolute(value.home)) throw new Error('Invalid DSH NEXT data location; refusing to guess')
  return resolve(value.home)
}

export function findApp({ app, userHome = homedir(), env = process.env, candidates } = {}) {
  if (app || env.DSH_NEXT_APP) {
    const selected = resolve(app || env.DSH_NEXT_APP)
    if (!existsSync(join(selected, 'Contents/Resources/app.asar'))) throw new Error('DSH NEXT app.asar not found at the specified application')
    return selected
  }
  const found = (candidates ?? [join(userHome, 'Applications/DSH NEXT.app'), '/Applications/DSH NEXT.app'])
    .filter(p => existsSync(join(p, 'Contents/Resources/app.asar')))
  if (found.length !== 1) throw new Error(found.length ? 'Multiple DSH NEXT apps found; specify --app' : 'DSH NEXT not found; specify --app')
  return resolve(found[0])
}
