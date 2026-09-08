/**
 * Now Playing — sticky video BrowserWindow (not selection-synced).
 * Distinct from detached Preview (D14): docked preview keeps following selection.
 */
import path from 'node:path'
import { BrowserWindow, screen } from 'electron'
import appIcon from '../../../resources/icon.png?asset'
import {
  PREVIEW_WINDOW_MIN_HEIGHT,
  PREVIEW_WINDOW_MIN_WIDTH,
  previewWindowDefaultBounds
} from '@shared/previewWindowBounds'
import { patchSettings, settingsStore } from '../settings/store'
import { broadcast } from '../ipc/events'
import { logMain } from '../logging'
import { stopMpvForWindowId } from './mpvPlayer'
import { requireAbsolute } from '../fs/list'

let nowPlayingWin: BrowserWindow | null = null
let sessionPath: string | null = null
let sessionStartAtSec: number | undefined
let sessionPaused: boolean | undefined

function defaultBounds(): { x: number; y: number; width: number; height: number } {
  const work = screen.getPrimaryDisplay().workArea
  // Slightly smaller than full preview pop-out — player-focused.
  const full = previewWindowDefaultBounds(work)
  const width = Math.max(PREVIEW_WINDOW_MIN_WIDTH, Math.round(full.width * 0.55))
  const height = Math.max(PREVIEW_WINDOW_MIN_HEIGHT, Math.round(full.height * 0.55))
  return {
    x: work.x + Math.max(0, Math.floor((work.width - width) / 2)),
    y: work.y + Math.max(0, Math.floor((work.height - height) / 2)),
    width: Math.min(width, work.width),
    height: Math.min(height, work.height)
  }
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
    return {
      ...fallback,
      width: Math.min(width, fallback.width),
      height: Math.min(height, fallback.height)
    }
  }
  return { x: saved.x, y: saved.y, width, height }
}

function persistBounds(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMinimized()) return
  const maximized = win.isMaximized()
  const b = maximized ? win.getNormalBounds() : win.getBounds()
  try {
    patchSettings({
      nowPlayingWindowBounds: {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        maximized
      }
    })
  } catch (e) {
    logMain(
      'warn',
      `persist now-playing window bounds: ${e instanceof Error ? e.message : String(e)}`
    )
  }
}

function isNowPlayingPageUrl(url: string): boolean {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) {
    const page = `${dev.replace(/\/$/, '')}/nowPlaying.html`
    return url === page || url.startsWith(`${page}?`) || url.startsWith(`${page}#`)
  }
  return /nowPlaying\.html(?:[?#]|$)/i.test(url)
}

function loadNowPlayingPage(win: BrowserWindow): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/nowPlaying.html`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/nowPlaying.html'))
  }
}

function attachGuards(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (isNowPlayingPageUrl(url)) return
    e.preventDefault()
  })
  win.webContents.on('did-navigate', (_e, url) => {
    if (win.isDestroyed() || isNowPlayingPageUrl(url)) return
    logMain('warn', `now-playing window navigated away (${url}); reloading`)
    loadNowPlayingPage(win)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    logMain('warn', `now-playing renderer gone: ${details.reason}`)
    if (!win.isDestroyed()) loadNowPlayingPage(win)
  })
}

function broadcastState(): void {
  broadcast({
    type: 'now-playing',
    payload: {
      path: sessionPath,
      open: sessionPath != null && nowPlayingWin != null,
      ...(sessionStartAtSec != null ? { startAtSec: sessionStartAtSec } : {}),
      ...(sessionPaused != null ? { paused: sessionPaused } : {})
    }
  })
}

function ensureWindow(): BrowserWindow {
  if (nowPlayingWin && !nowPlayingWin.isDestroyed()) {
    return nowPlayingWin
  }

  const saved = settingsStore().get().nowPlayingWindowBounds
  const bounds = saved ? clampOntoDisplay(saved) : defaultBounds()

  nowPlayingWin = new BrowserWindow({
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
    title: 'Now Playing',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const win = nowPlayingWin
  const windowId = win.id
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
    stopMpvForWindowId(windowId)
    if (nowPlayingWin === win) nowPlayingWin = null
    sessionPath = null
    sessionStartAtSec = undefined
    sessionPaused = undefined
    broadcastState()
  })

  void win.webContents.setVisualZoomLevelLimits(1, 1)
  attachGuards(win)
  loadNowPlayingPage(win)
  return win
}

export function getNowPlaying(): {
  path: string | null
  open: boolean
  startAtSec?: number
  paused?: boolean
} {
  const open = sessionPath != null && nowPlayingWin != null && !nowPlayingWin.isDestroyed()
  return {
    path: open ? sessionPath : null,
    open,
    ...(open && sessionStartAtSec != null ? { startAtSec: sessionStartAtSec } : {}),
    ...(open && sessionPaused != null ? { paused: sessionPaused } : {})
  }
}

/** Start or replace sticky playback for an absolute video path. */
export function startNowPlaying(
  rawPath: string,
  opts?: { startAtSec?: number; paused?: boolean }
): { path: string; open: true } {
  const file = requireAbsolute(rawPath)
  const win = ensureWindow()
  const pathChanged = sessionPath !== file
  const hasHandoff =
    (opts?.startAtSec != null && Number.isFinite(opts.startAtSec) && opts.startAtSec > 0) ||
    opts?.paused === true ||
    opts?.paused === false

  // Same sticky path without a new resume offset — focus only (Keep playing → Show Now Playing).
  if (!pathChanged && !hasHandoff && sessionPath != null) {
    if (!win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    return { path: file, open: true }
  }

  sessionPath = file
  sessionStartAtSec =
    opts?.startAtSec != null && Number.isFinite(opts.startAtSec) && opts.startAtSec > 0
      ? opts.startAtSec
      : undefined
  sessionPaused = opts?.paused === true ? true : opts?.paused === false ? false : undefined
  win.setTitle(`Now Playing — ${path.basename(file)}`)
  // Broadcast handoff so Now Playing seeks once; path change resets the player.
  broadcast({
    type: 'now-playing',
    payload: {
      path: file,
      open: true,
      ...(sessionStartAtSec != null ? { startAtSec: sessionStartAtSec } : {}),
      ...(sessionPaused != null ? { paused: sessionPaused } : {})
    }
  })
  if (!win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  return { path: file, open: true }
}

export function stopNowPlaying(): { stopped: boolean } {
  if (!nowPlayingWin || nowPlayingWin.isDestroyed()) {
    const had = sessionPath != null
    sessionPath = null
    sessionStartAtSec = undefined
    sessionPaused = undefined
    if (had) broadcastState()
    return { stopped: had }
  }
  const win = nowPlayingWin
  sessionPath = null
  sessionStartAtSec = undefined
  sessionPaused = undefined
  win.close()
  return { stopped: true }
}

/**
 * Ask the main explorer window to dock into the preview pane.
 * Does **not** close Now Playing — the explorer accepts (stop + resume) only when
 * the playing file is already the preview target (no forced re-select / tab jump).
 */
export function requestDockNowPlaying(opts?: {
  startAtSec?: number
  paused?: boolean
}): { requested: boolean; path: string | null } {
  const file = sessionPath
  if (!file) return { requested: false, path: null }
  broadcast({
    type: 'now-playing-dock-request',
    payload: {
      path: file,
      ...(opts?.startAtSec != null && Number.isFinite(opts.startAtSec) && opts.startAtSec > 0
        ? { startAtSec: opts.startAtSec }
        : {}),
      ...(opts?.paused === true ? { paused: true } : opts?.paused === false ? { paused: false } : {})
    }
  })
  return { requested: true, path: file }
}

/** Stop if the sticky path is this file or under a deleted/moved folder. */
export function stopNowPlayingIfAffected(paths: string[]): boolean {
  if (!sessionPath) return false
  const playing = sessionPath.toLowerCase()
  for (const raw of paths) {
    try {
      const p = requireAbsolute(raw).toLowerCase()
      if (playing === p || playing.startsWith(p + path.sep)) {
        stopNowPlaying()
        return true
      }
    } catch {
      /* ignore bad paths */
    }
  }
  return false
}
