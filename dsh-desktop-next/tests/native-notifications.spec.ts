import { expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES, type DesktopBridge, type DesktopState } from '../src/desktop-contract.ts'
import { NextSettingsAdapter } from '../src/client/settings-adapter.ts'
import { NativeDesktop } from '../src/native-desktop.ts'

const { show, setMenu } = vi.hoisted(() => ({ show: vi.fn(), setMenu: vi.fn() }))
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (items: unknown) => items, setApplicationMenu: setMenu },
  Notification: class {
    static isSupported(): boolean { return true }
    once(): void {}
    show = show
    close(): void {}
  },
}))

it('retains the new-window action through menu refreshes and language changes', () => {
  const run = vi.fn()
  let language = 'zh-CN'
  const native = new NativeDesktop({
    root: '/fixture', language: () => language,
    state: () => ({ preferences: { ...DEFAULT_PREFERENCES }, phase: 'ready', features: {}, profiles: ['desktop'], unavailableProfiles: [] }) as unknown as DesktopState,
    window: () => undefined, show() {}, run, warn() {},
  })
  for (const locale of ['zh-CN', 'en', 'zh-CN']) {
    language = locale
    native.refresh()
    const action = setMenu.mock.lastCall![0].find((item: any) => item.role === 'windowMenu').submenu[0]
    expect(action.label).toBe(locale === 'en' ? 'New Independent Window' : '新建独立窗口')
    expect(action.accelerator).toBe('CmdOrCtrl+Shift+N')
    action.click()
  }
  expect(run.mock.calls).toEqual([[{ type: 'new-window' }], [{ type: 'new-window' }], [{ type: 'new-window' }]])
})

it('uses notification switches saved by the settings form on every native delivery', async () => {
  const state = {
    preferences: { ...DEFAULT_PREFERENCES }, busy: false, notificationsAvailable: true,
  } as DesktopState
  const command = vi.fn(async (command: Parameters<DesktopBridge['command']>[0]) => {
    if (command.type === 'preferences') state.preferences = command.preferences
  })
  const adapter = new NextSettingsAdapter({
    state: async () => structuredClone(state), command,
    browserLinks: async () => ({ localUrl: null, lanUrls: [] }),
  })
  const native = new NativeDesktop({
    root: '/fixture', language: () => 'en', state: () => state, window: () => undefined,
    show() {}, run() {}, warn() {},
  })
  const completed = { outcome: 'turn-completed', userMessage: 'Prompt', assistantMessage: 'Reply' } as const
  const failed = { outcome: 'turn-failed' } as const
  const scheduled = { outcome: 'schedule-completed' } as const
  const scheduledFailed = { outcome: 'schedule-failed' } as const
  show.mockClear()
  try {
    native.notify(completed)
    expect(show).toHaveBeenCalledTimes(1)
    await adapter.notificationSettings.set('enabled', false)
    native.notify(completed)
    native.notify(failed)
    expect(show).toHaveBeenCalledTimes(1)

    await adapter.notificationSettings.set('enabled', true)
    await adapter.notificationSettings.set('notifyOnTurnCompletion', false)
    native.notify(completed)
    native.notify(failed)
    expect(show).toHaveBeenCalledTimes(2)

    await adapter.notificationSettings.set('notifyOnTurnFailure', false)
    native.notify(failed)
    expect(show).toHaveBeenCalledTimes(2)
    await adapter.notificationSettings.set('notifyOnTurnCompletion', true)
    native.notify(completed)
    expect(show).toHaveBeenCalledTimes(3)
    await adapter.notificationSettings.set('notifyOnScheduleCompletion', false)
    native.notify(scheduled)
    expect(show).toHaveBeenCalledTimes(3)
    native.notify(scheduledFailed)
    expect(show).toHaveBeenCalledTimes(4)
    await adapter.notificationSettings.set('notifyOnScheduleFailure', false)
    native.notify(scheduledFailed)
    expect(show).toHaveBeenCalledTimes(4)
    expect(command.mock.calls.every(([command]) => command.type === 'preferences')).toBe(true)
  } finally { native.close() }
})
