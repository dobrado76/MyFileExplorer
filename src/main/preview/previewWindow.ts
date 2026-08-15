/**
 * Detached preview BrowserWindow — peer of the explorer (no parent).
 */
import path from 'node:path'
import { BrowserWindow, screen } from 'electron'
import appIcon from '../../../resources/icon.png?asset'
import type { PreviewWindowTarget } from '@shared/schemas/preview'
import {
  PREVIEW_WINDOW_MIN_HEIGHT,
  PREVIEW_WINDOW_MIN_WIDTH,
  previewWindowDefaultBounds
} from '@shared/previewWindowBounds'
import { patchSettings, settingsStore } from '../settings/store'
import { broadcast } from '../ipc/events'
import { logMain } from '../logging'

let previewWin: BrowserWindow | null = null

let lastTarget: PreviewWindowTarget = { path: null, ads: undefined, stamp: null }

function defaultBounds(): { x: number; y: number; width: number; height: number } {
  return previewWindowDefaultBounds(screen.getPrimaryDisplay().workArea)
}

function clampOntoDisplay(saved: {
  x: number
  y: number
  width: number
  height: number
}): { x: number; y: number; width: number; height: number } {
  const width = Math.max(PREVIEW_WINDOW_MIN_WIDTH, saved.width)
  const height = Math.max(PREVIEW_WINDOW_MIN_HEIGHT, saved.height)
  const onScreen = screen.getAllDisplays().some((d) => {
    const b = d.workArea
    return (
      saved.x >= b.x - 50 &&
      saved.y >= b.y - 50 &&
      saved.x < b.x + b.width &&
      saved.y < b.y + b.height
    )
  })
  if (!onScreen) {
    const fallback = defaultBounds()
    return { ...fallback, width: Math.min(width, fallback.width), height: Math.min(height, fallback.height) }
  }
  return { x: saved.x, y: saved.y, width, height }
}

function persistBounds(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMinimized()) return
  const maximized = win.isMaximized()
  const b = maximized ? win.getNormalBounds() : win.getBounds()
  try {
    patchSettings({
      previewWindowBounds: {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        maximized
      }
    })
  } catch (e) {
    logMain('warn', `persist preview window bounds: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function sameTarget(a: PreviewWindowTarget, b: PreviewWindowTarget): boolean {
  return a.path === b.path && a.ads === b.ads && a.stamp === b.stamp
}

function isPreviewWindowPageUrl(url: string): boolean {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) {
    const page = `${dev.replace(/\/$/, '')}/previewWindow.html`
    return url === page || url.startsWith(`${page}?`) || url.startsWith(`${page}#`)
  }
  return /previewWindow\.html(?:[?#]|$)/i.test(url)
}

function loadPreviewWindowPage(win: BrowserWindow): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/previewWindow.html`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/previewWindow.html'))
  }
}

function attachPreviewWindowGuards(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (isPreviewWindowPageUrl(url)) return
    e.preventDefault()
  })
  win.webContents.on('did-navigate', (_e, url) => {
    if (win.isDestroyed() || isPreviewWindowPageUrl(url)) return
    logMain('warn', `preview window navigated away (${url}); reloading`)
    loadPreviewWindowPage(win)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    logMain('warn', `preview window renderer gone: ${details.reason}`)
    if (!win.isDestroyed()) loadPreviewWindowPage(win)
  })
}

export function setPreviewTarget(next: PreviewWindowTarget): { ok: true } {
  if (sameTarget(lastTarget, next)) return { ok: true }
  lastTarget = next
  broadcast({ type: 'preview-target', payload: next })
  return { ok: true }
}

export function getPreviewTarget(): PreviewWindowTarget {
  return lastTarget
}

export function openPreviewWindow(): { opened: true } {
  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.focus()
    return { opened: true }
  }

  // Unmount the docked <video> before this window starts the same media URL.
  broadcast({ type: 'preview-window', payload: { open: true } })

  const saved = settingsStore().get().previewWindowBounds
  const bounds = saved ? clampOntoDisplay(saved) : defaultBounds()

  previewWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: PREVIEW_WINDOW_MIN_WIDTH,
    minHeight: PREVIEW_WINDOW_MIN_HEIGHT,
    show: false,
    icon: appIcon,
    autoHideMenuBar: true,
    backgroundColor: '#12141a',
    title: 'Preview',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const win = previewWin
  const save = (): void => persistBounds(win)
  win.on('resize', save)
  win.on('move', save)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.once('ready-to-show', () => {
    if (saved?.maximized) win.maximize()
    win.show()
  })
  win.on('close', () => persistBounds(win))
  win.on('closed', () => {
    if (previewWin === win) previewWin = null
    // Skip if a newer pop-out already owns `previewWin` (close-then-reopen).
    if (previewWin == null) {
      broadcast({ type: 'preview-window', payload: { open: false } })
    }
  })

  void win.webContents.setVisualZoomLevelLimits(1, 1)
  attachPreviewWindowGuards(win)
  loadPreviewWindowPage(win)

  return { opened: true }
}

export function closePreviewWindow(): { closed: boolean } {
  if (!previewWin || previewWin.isDestroyed()) return { closed: false }
  const win = previewWin
  previewWin = null
  win.close()
  return { closed: true }
}

export function getPreviewWindow(): BrowserWindow | null {
  return previewWin && !previewWin.isDestroyed() ? previewWin : null
}
