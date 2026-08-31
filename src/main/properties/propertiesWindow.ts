/**
 * Detached Properties BrowserWindows — peers of the explorer (no parent).
 * Default multi-select: one combined sheet. Shift: one window per path.
 */
import path from 'node:path'
import { BrowserWindow, screen } from 'electron'
import appIcon from '../../../resources/icon.png?asset'
import { pathKey } from '@shared/paths'
import { combinedPropertiesWindowKey } from '@shared/propertiesCombine'
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

export type PropertiesWindowArgs =
  | { mode: 'single'; path: string }
  | { mode: 'combined'; paths: string[] }

const openByKey = new Map<string, BrowserWindow>()
const argsByContentsId = new Map<number, PropertiesWindowArgs>()

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

function loadPropertiesWindowPage(win: BrowserWindow, args: PropertiesWindowArgs): void {
  const q =
    args.mode === 'single'
      ? `?path=${encodeURIComponent(args.path)}`
      : `?combined=1`
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/propertiesWindow.html${q}`)
  } else if (args.mode === 'single') {
    void win.loadFile(path.join(__dirname, '../renderer/propertiesWindow.html'), {
      query: { path: args.path }
    })
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/propertiesWindow.html'), {
      query: { combined: '1' }
    })
  }
}

function attachPropertiesWindowGuards(win: BrowserWindow, args: PropertiesWindowArgs): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (isPropertiesWindowPageUrl(url)) return
    e.preventDefault()
  })
  win.webContents.on('did-navigate', (_e, url) => {
    if (win.isDestroyed() || isPropertiesWindowPageUrl(url)) return
    logMain('warn', `properties window navigated away (${url}); reloading`)
    loadPropertiesWindowPage(win, args)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    logMain('warn', `properties window renderer gone: ${details.reason}`)
    if (!win.isDestroyed()) loadPropertiesWindowPage(win, args)
  })
}

function spawnPropertiesWindow(key: string, args: PropertiesWindowArgs): BrowserWindow {
  const saved = savedBoundsFromSettings()
  const base = saved ? clampOntoDisplay(saved) : defaultBounds()
  const bounds = cascadeOffset(base, cascadeIndex++)
  const title =
    args.mode === 'combined'
      ? `${args.paths.length} items — Properties`
      : `${path.basename(args.path) || args.path} Properties`

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
    title,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  openByKey.set(key, win)
  const contentsId = win.webContents.id
  argsByContentsId.set(contentsId, args)

  const save = (): void => persistBounds(win)
  win.on('resize', save)
  win.on('move', save)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    if (saved?.maximized) win.maximize()
    if (!win.isDestroyed()) win.show()
  })
  win.on('close', () => {
    if (!win.isDestroyed()) persistBounds(win)
  })
  win.on('closed', () => {
    if (openByKey.get(key) === win) openByKey.delete(key)
    argsByContentsId.delete(contentsId)
  })

  void win.webContents.setVisualZoomLevelLimits(1, 1)
  attachPropertiesWindowGuards(win, args)
  loadPropertiesWindowPage(win, args)
  return win
}

function focusOrSpawn(key: string, args: PropertiesWindowArgs): void {
  const existing = openByKey.get(key)
  if (existing && !existing.isDestroyed()) {
    argsByContentsId.set(existing.webContents.id, args)
    existing.focus()
    return
  }
  spawnPropertiesWindow(key, args)
}

export function getPropertiesWindowArgs(webContentsId: number): PropertiesWindowArgs | null {
  return argsByContentsId.get(webContentsId) ?? null
}

export function openPropertiesWindows(
  paths: string[],
  opts?: { separate?: boolean }
): { opened: number; skipped: number } {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of paths) {
    const abs = normalizeAbsolute(raw)
    if (!abs) continue
    const key = pathKey(abs)
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(abs)
  }

  if (normalized.length === 0) return { opened: 0, skipped: 0 }

  const separate = opts?.separate === true

  // Single item, or Shift+separate: one window per path.
  if (normalized.length === 1 || separate) {
    let opened = 0
    let skipped = 0
    for (const abs of normalized) {
      if (opened >= PROPERTIES_WINDOW_MAX_OPEN) {
        skipped += 1
        continue
      }
      focusOrSpawn(pathKey(abs), { mode: 'single', path: abs })
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

  // Default multi-select: one combined sheet (Explorer-style).
  focusOrSpawn(combinedPropertiesWindowKey(normalized), {
    mode: 'combined',
    paths: normalized
  })
  return { opened: 1, skipped: 0 }
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
  argsByContentsId.clear()
  return { closed }
}
