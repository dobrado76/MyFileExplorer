import { BrowserWindow } from 'electron'
import { broadcast } from './ipc/events'
import { parseOpenArgs, type ExternalOpenRequest } from './openTarget'

const pending: ExternalOpenRequest[] = []
let rendererReady = false
let mainWindow: BrowserWindow | null = null

/** Track the explorer shell window (not secondary windows like Compiled lists). */
export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function focusMainWindow(): BrowserWindow | null {
  const win = getMainWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  if (!win || win.isDestroyed()) return null
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

export function dispatchOpens(reqs: ExternalOpenRequest[]): void {
  if (reqs.length === 0) return
  if (!rendererReady) {
    pending.push(...reqs)
    return
  }
  for (const req of reqs) {
    broadcast({ type: 'external-open', payload: req })
  }
}

export function dispatchFromArgv(argv: string[]): void {
  dispatchOpens(parseOpenArgs(argv))
}

/** Called from IPC when the renderer has finished booting. */
export function markRendererReady(): void {
  rendererReady = true
  if (pending.length === 0) return
  const batch = pending.splice(0, pending.length)
  for (const req of batch) {
    broadcast({ type: 'external-open', payload: req })
  }
}
