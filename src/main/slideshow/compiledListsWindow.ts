/**
 * Detached Compiled Lists BrowserWindow.
 */
import path from 'node:path'
import { BrowserWindow, screen } from 'electron'
import appIcon from '../../../resources/icon.png?asset'
import { patchSettings, settingsStore } from '../settings/store'
import { broadcast } from '../ipc/events'
import { logMain } from '../logging'
import { getMainWindow } from '../externalOpen'

let listsWin: BrowserWindow | null = null

function defaultBounds(): { x: number; y: number; width: number; height: number } {
  const wa = screen.getPrimaryDisplay().workArea
  const width = Math.min(900, wa.width)
  const height = Math.min(640, wa.height)
  return {
    x: wa.x + Math.max(0, Math.floor((wa.width - width) / 2)),
    y: wa.y + Math.max(0, Math.floor((wa.height - height) / 2)),
    width,
    height
  }
}

function persistBounds(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMinimized()) return
  const b = win.getBounds()
  try {
    patchSettings({
      compiledListsWindowBounds: {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height
      }
    })
  } catch (e) {
    logMain('warn', `persist compiled lists bounds: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export function openCompiledListsWindow(): { opened: true } {
  if (listsWin && !listsWin.isDestroyed()) {
    listsWin.focus()
    return { opened: true }
  }

  const saved = settingsStore().get().compiledListsWindowBounds
  const bounds = saved ?? defaultBounds()
  const parent = getMainWindow() ?? undefined

  listsWin = new BrowserWindow({
    parent,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 480,
    minHeight: 360,
    show: false,
    icon: appIcon,
    autoHideMenuBar: true,
    backgroundColor: '#12141a',
    title: 'Compiled lists',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const win = listsWin
  win.once('ready-to-show', () => win.show())
  win.on('close', () => persistBounds(win))
  win.on('closed', () => {
    // If a newer lists window already replaced this one, do not pair-stop the slideshow.
    if (listsWin !== win) return
    listsWin = null
    broadcast({ type: 'compiled-lists-window-closed', payload: {} })
  })

  void win.webContents.setVisualZoomLevelLimits(1, 1)

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/compiledLists.html`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/compiledLists.html'))
  }

  return { opened: true }
}

export function closeCompiledListsWindow(): { closed: boolean } {
  if (!listsWin || listsWin.isDestroyed()) return { closed: false }
  const win = listsWin
  // Detach before close so a quick re-open can own `listsWin` without the old
  // `closed` handler killing the new compiled session.
  listsWin = null
  win.close()
  return { closed: true }
}

export function getCompiledListsWindow(): BrowserWindow | null {
  return listsWin && !listsWin.isDestroyed() ? listsWin : null
}
