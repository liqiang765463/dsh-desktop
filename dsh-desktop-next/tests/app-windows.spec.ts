import { describe, expect, it } from 'vitest'
import { ApplicationWindows } from '../src/app-windows.ts'
function window(id: number) { return { isDestroyed: () => false, isFocused: () => false, webContents: { id, mainFrame: { url: 'dsh-app://app/' } } } }
describe('independent application window ownership', () => {
  it('resolves each sender without depending on whichever window is focused', () => {
    const windows = new ApplicationWindows<ReturnType<typeof window>>()
    const a = window(1), b = window(2)
    windows.add(a, 0); windows.add(b, 1)
    expect(windows.owner({ sender: a.webContents, senderFrame: a.webContents.mainFrame })).toBe(a)
    expect(windows.owner({ sender: b.webContents, senderFrame: b.webContents.mainFrame })).toBe(b)
    expect(windows.nextSlot()).toBe(2)
    windows.delete(a)
    expect(windows.active()).toBe(b)
    expect(windows.owner({ sender: b.webContents, senderFrame: b.webContents.mainFrame })).toBe(b)
  })
  it('rejects foreign contents, subframes and retired windows', () => {
    const windows = new ApplicationWindows<ReturnType<typeof window>>(), a = window(1)
    windows.add(a, 0)
    expect(() => windows.owner({ sender: window(2).webContents, senderFrame: a.webContents.mainFrame })).toThrow('Rejected')
    expect(() => windows.owner({ sender: a.webContents, senderFrame: { url: 'dsh-app://app/' } })).toThrow('Rejected')
    a.webContents.mainFrame.url = 'https://example.com/'
    expect(() => windows.owner({ sender: a.webContents, senderFrame: a.webContents.mainFrame })).toThrow('Rejected')
    a.webContents.mainFrame.url = 'dsh-app://app/'
    windows.delete(a)
    expect(() => windows.owner({ sender: a.webContents, senderFrame: a.webContents.mainFrame })).toThrow('Rejected')
  })
})
