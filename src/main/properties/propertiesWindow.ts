/**
 * Detached Properties BrowserWindows — peers of the explorer (no parent).
 * One window per path; re-open focuses an existing window for that path.
 */
import path from 'node:path'
import { BrowserWindow, screen } from 'electron'
import appIcon from '../../../resources/icon.png?asset'
import { pathKey } from '@shared/paths'
import {
  PROPERTIES_WINDOW_CASCADE_PX,
  PROPERTIES_WINDOW_MAX_OPEN,
  PROPERTIES_WINDOW_MIN_HEIGHT,
  PROPERTIES_WINDOW_MIN_WIDTH,
  propertiesWindowDefaultBounds
} from '@shared/propertiesWindowBounds'
import { normalizeAbsolute } from '../security/paths'
import { patchSettings, settingsStore } from '../settings/store'
import { logMain } from '../logging'

const openByKey = new Map<string, BrowserWindow>()

let cascadeIndex = 0

function defaultBounds(): { x: number; y: number; width: number; height: number } {
  return propertiesWindowDefaultBounds(screen.getPrimaryDisplay().workArea)
}

function clampOntoDisplay(saved: {
  x: number
  y: number
  width: number
  height: number
}): { x: number; y: number; width: number; height: number } {
  const width = Math.max(PROPERTIES_WINDOW_MIN_WIDTH, saved.width)
  const height = Math.max(PROPERTIES_WINDOW_MIN_HEIGHT, saved.height)
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

/** Prefer Electron window bounds; fall back to legacy in-app dialog geometry. */
function savedBoundsFromSettings(): {
  x: number
  y: number
  width: number
  height: number
  maximized?: boolean
} | null {
  const s = settingsStore().get()
  if (s.propertiesWindowBounds) return s.propertiesWindowBounds
  if (s.propertiesBounds) {
    return { ...s.propertiesBounds, maximized: false }
  }
  return null
}

function persistBounds(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMinimized()) return
  const maximized = win.isMaximized()
  const b = maximized ? win.getNormalBounds() : win.getBounds()
  try {
    patchSettings({
      propertiesWindowBounds: {
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
      `persist properties window bounds: ${e instanceof Error ? e.message : String(e)}`
    )
  }
}

function cascadeOffset(
  base: { x: number; y: number; width: number; height: number },
  index: number
): { x: number; y: number; width: number; height: number } {
  const step = PROPERTIES_WINDOW_CASCADE_PX * (index % 12)
  return { ...base, x: base.x + step, y: base.y + step }
}

function isPropertiesWindowPageUrl(url: string): boolean {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) {
    const page = `${dev.replace(/\/$/, '')}/propertiesWindow.html`
    return url === page || url.startsWith(`${page}?`) || url.startsWith(`${page}#`)
  }
  return /propertiesWindow\.html(?:[?#]|$)/i.test(url)
}

function loadPropertiesWindowPage(win: BrowserWindow, targetPath: string): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    const q = `?path=${encodeURIComponent(targetPath)}`
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/propertiesWindow.html${q}`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/propertiesWindow.html'), {
      query: { path: targetPath }
    })
  }
}

function attachPropertiesWindowGuards(win: BrowserWindow, targetPath: string): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (isPropertiesWindowPageUrl(url)) return
    e.preventDefault()
  })
  win.webContents.on('did-navigate', (_e, url) => {
    if (win.isDestroyed() || isPropertiesWindowPageUrl(url)) return
    logMain('warn', `properties window navigated away (${url}); reloading`)
    loadPropertiesWindowPage(win, targetPath)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    logMain('warn', `properties window renderer gone: ${details.reason}`)
    if (!win.isDestroyed()) loadPropertiesWindowPage(win, targetPath)
  })
}

function spawnPropertiesWindow(absPath: string, key: string): BrowserWindow {
  const saved = savedBoundsFromSettings()
  const base = saved ? clampOntoDisplay(saved) : defaultBounds()
  const bounds = cascadeOffset(base, cascadeIndex++)
  const titleStem = path.basename(absPath) || absPath

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: PROPERTIES_WINDOW_MIN_WIDTH,
    minHeight: PROPERTIES_WINDOW_MIN_HEIGHT,
    show: false,
    icon: appIcon,
    autoHideMenuBar: true,
    backgroundColor: '#12141a',
    title: `${titleStem} Properties`,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  openByKey.set(key, win)

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
    if (openByKey.get(key) === win) openByKey.delete(key)
  })

  void win.webContents.setVisualZoomLevelLimits(1, 1)
  attachPropertiesWindowGuards(win, absPath)
  loadPropertiesWindowPage(win, absPath)
  return win
}

export function openPropertiesWindows(paths: string[]): { opened: number; skipped: number } {
  const seen = new Set<string>()
  const normalized: { abs: string; key: string }[] = []
  for (const raw of paths) {
    const abs = normalizeAbsolute(raw)
    if (!abs) continue
    const key = pathKey(abs)
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({ abs, key })
  }

  let opened = 0
  let skipped = 0
  for (const { abs, key } of normalized) {
    if (opened >= PROPERTIES_WINDOW_MAX_OPEN) {
      skipped += 1
      continue
    }
    const existing = openByKey.get(key)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      opened += 1
      continue
    }
    spawnPropertiesWindow(abs, key)
    opened += 1
  }

  if (skipped > 0) {
    logMain(
      'info',
      `properties windows: opened ${opened}, skipped ${skipped} (cap ${PROPERTIES_WINDOW_MAX_OPEN})`
    )
  }

  return { opened, skipped }
}

export function closeAllPropertiesWindows(): { closed: number } {
  let closed = 0
  for (const win of [...openByKey.values()]) {
    if (!win.isDestroyed()) {
      win.close()
      closed += 1
    }
  }
  openByKey.clear()
  return { closed }
}
