/**
 * Same-process extra explorer shells (D73). One session.json writer path:
 * main `session:set` merges; floats only replace their own tabs.
 */
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, screen, type WebContents } from 'electron'
import appIcon from '../../../resources/icon.png?asset'
import { mergeFloatTabs, tabWindowId } from '@shared/explorerSession'
import { layoutTabSchema, type LayoutFloatWire, type LayoutWindowFrame } from '@shared/layouts'
import {
  MAIN_SHELL_ID,
  MAX_CLOSED_TABS,
  MAX_CLOSED_WINDOWS,
  type ClosedWindowEntry,
  type ExplorerWindowBounds,
  type ExplorerWindowState,
  type SessionState,
  type TabState
} from '@shared/schemas/session'
import { broadcast, sendToWindow } from '../ipc/events'
import { logMain } from '../logging'
import { sessionStore } from '../session/store'
import { getMainWindow } from '../externalOpen'

const shells = new Map<string, BrowserWindow>()
const allowClose = new Set<string>()
/** Shell ids closed by a layout replace. Late saveTabs from those windows are ignored. */
const retiredShellIds = new Set<string>()
let ignoreSessionWrites = false
const flushWaiters = new Map<string, () => void>()
let layoutOpWaiter: ((layout: unknown) => void) | null = null

export function sessionWritesLocked(): boolean {
  return ignoreSessionWrites
}

export function lockSessionWrites(): void {
  ignoreSessionWrites = true
}

export function shellIdFromContents(wc: WebContents): string {
  for (const [id, win] of shells) {
    if (!win.isDestroyed() && win.webContents.id === wc.id) return id
  }
  return MAIN_SHELL_ID
}

export function registerMainShell(win: BrowserWindow): void {
  shells.set(MAIN_SHELL_ID, win)
}

export function hasOpenFloats(): boolean {
  for (const [id, win] of shells) {
    if (id !== MAIN_SHELL_ID && !win.isDestroyed()) return true
  }
  return false
}

function roster(): void {
  broadcast({
    type: 'shell-roster',
    payload: { closedWindows: sessionStore().get().closedWindows }
  })
}

function loadExplorer(win: BrowserWindow): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function explorerWebPreferences(shellId: string): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    additionalArguments: [`--mfe-shell=${shellId}`]
  }
}

function defaultFloatBounds(): ExplorerWindowBounds {
  const parent = getMainWindow()
  const base =
    parent && !parent.isDestroyed()
      ? parent.getBounds()
      : { x: 80, y: 80, width: 1200, height: 800 }
  const area = screen.getDisplayNearestPoint({ x: base.x, y: base.y }).workArea
  const width = Math.min(Math.max(960, base.width), area.width)
  const height = Math.min(Math.max(640, base.height), area.height)
  return {
    x: Math.min(base.x + 40, area.x + area.width - width),
    y: Math.min(base.y + 40, area.y + area.height - height),
    width,
    height
  }
}

function persistFloatBounds(shellId: string, win: BrowserWindow): void {
  if (ignoreSessionWrites || win.isDestroyed()) return
  const maximized = win.isMaximized()
  const b = maximized ? win.getNormalBounds() : win.getBounds()
  const session = sessionStore().get()
  const bounds: ExplorerWindowBounds = {
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height
  }
  sessionStore().set({
    ...session,
    explorerWindows: session.explorerWindows.map((w) =>
      w.id === shellId ? { ...w, bounds, maximized } : w
    )
  })
}

function openFloat(meta: ExplorerWindowState): void {
  if (shells.get(meta.id) && !shells.get(meta.id)!.isDestroyed()) {
    shells.get(meta.id)!.focus()
    return
  }
  const bounds = meta.bounds ?? defaultFloatBounds()
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 640,
    minHeight: 400,
    show: false,
    icon: appIcon,
    autoHideMenuBar: true,
    backgroundColor: '#12141a',
    webPreferences: explorerWebPreferences(meta.id)
  })
  shells.set(meta.id, win)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  void win.webContents.setVisualZoomLevelLimits(1, 1)
  ;(win.webContents as Electron.WebContents & {
    on(
      event: 'app-command',
      listener: (event: Electron.Event, cmd: string) => void
    ): Electron.WebContents
  }).on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') {
      sendToWindow(win, { type: 'history-nav', payload: { dir: 'back' } })
    } else if (cmd === 'browser-forward') {
      sendToWindow(win, { type: 'history-nav', payload: { dir: 'forward' } })
    }
  })
  win.once('ready-to-show', () => {
    if (meta.maximized) win.maximize()
    win.show()
  })
  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => persistFloatBounds(meta.id, win), 400)
  }
  win.on('move', scheduleBounds)
  win.on('resize', scheduleBounds)
  win.on('close', (e) => {
    if (allowClose.has(meta.id) || ignoreSessionWrites) return
    const hasTabs = sessionStore()
      .get()
      .tabs.some((t) => tabWindowId(t) === meta.id)
    if (!hasTabs) return
    e.preventDefault()
    sendToWindow(win, { type: 'shell-close-request', payload: { windowId: meta.id } })
  })
  win.on('closed', () => {
    shells.delete(meta.id)
    allowClose.delete(meta.id)
  })
  loadExplorer(win)
}

export function restoreExplorerFloats(): void {
  const session = sessionStore().get()
  for (const w of session.explorerWindows) {
    if (w.kind !== 'float') continue
    if (!session.tabs.some((t) => tabWindowId(t) === w.id)) continue
    openFloat(w)
  }
}

function freshTabId(): string {
  return `tab_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`
}

export function detachTab(tab: TabState, fromShellId: string): { windowId: string } {
  const windowId = `float_${randomUUID().slice(0, 8)}`
  const session = sessionStore().get()
  const stamped: TabState = { ...tab, windowId }
  const next: SessionState = {
    ...session,
    tabs: [...session.tabs.filter((t) => t.id !== tab.id), stamped],
    explorerWindows: [
      ...session.explorerWindows,
      {
        id: windowId,
        kind: 'float' as const,
        bounds: defaultFloatBounds(),
        maximized: false,
        activeTabId: tab.id
      }
    ]
  }
  if (fromShellId !== MAIN_SHELL_ID && session.activeTabId === tab.id) {
    /* float active id lives on the window record */
  }
  sessionStore().set(next)
  const left = next.tabs.filter((t) => tabWindowId(t) === fromShellId)
  if (fromShellId !== MAIN_SHELL_ID && left.length === 0) {
    const emptied: SessionState = {
      ...next,
      explorerWindows: next.explorerWindows.filter((w) => w.id !== fromShellId)
    }
    sessionStore().set(emptied)
    allowClose.add(fromShellId)
    shells.get(fromShellId)?.close()
  } else if (fromShellId !== MAIN_SHELL_ID) {
    sessionStore().set({
      ...sessionStore().get(),
      explorerWindows: sessionStore()
        .get()
        .explorerWindows.map((w) =>
          w.id === fromShellId && w.activeTabId === tab.id
            ? { ...w, activeTabId: left[0]?.id ?? null }
            : w
        )
    })
  }
  const meta = sessionStore()
    .get()
    .explorerWindows.find((w) => w.id === windowId)
  if (meta) openFloat(meta)
  logMain('info', `Explorer float ${windowId} for tab ${tab.id}`)
  return { windowId }
}

export function mergeShellToMain(shellId: string): { tabs: TabState[] } {
  if (shellId === MAIN_SHELL_ID) return { tabs: [] }
  const session = sessionStore().get()
  const moved = session.tabs
    .filter((t) => tabWindowId(t) === shellId)
    .map((t) => ({ ...t, windowId: MAIN_SHELL_ID }))
  const rest = session.tabs.filter((t) => tabWindowId(t) !== shellId)
  sessionStore().set({
    ...session,
    tabs: [...rest, ...moved],
    explorerWindows: session.explorerWindows.filter((w) => w.id !== shellId),
    activeTabId: session.activeTabId ?? moved[0]?.id ?? null
  })
  broadcast({ type: 'shell-tabs-arrived', payload: { tabs: moved } })
  allowClose.add(shellId)
  const win = shells.get(shellId)
  if (win && !win.isDestroyed()) win.close()
  return { tabs: moved }
}

export function discardShell(shellId: string, tabs: TabState[]): { closedWindows: ClosedWindowEntry[] } {
  if (shellId === MAIN_SHELL_ID) return { closedWindows: sessionStore().get().closedWindows }
  const session = sessionStore().get()
  const meta = session.explorerWindows.find((w) => w.id === shellId)
  const snap = (tabs.length > 0 ? tabs : session.tabs.filter((t) => tabWindowId(t) === shellId)).map(
    (t) => ({ tab: { ...t, windowId: MAIN_SHELL_ID }, paneIndex: 0 as number | null })
  )
  const closed: ClosedWindowEntry[] = snap.length
    ? [
        {
          closedAt: Date.now(),
          bounds: meta?.bounds ?? null,
          maximized: meta?.maximized === true,
          tabs: snap
        },
        ...session.closedWindows
      ].slice(0, MAX_CLOSED_WINDOWS)
    : session.closedWindows
  sessionStore().set({
    ...session,
    tabs: session.tabs.filter((t) => tabWindowId(t) !== shellId),
    explorerWindows: session.explorerWindows.filter((w) => w.id !== shellId),
    closedWindows: closed
  })
  roster()
  allowClose.add(shellId)
  const win = shells.get(shellId)
  if (win && !win.isDestroyed()) win.close()
  return { closedWindows: closed }
}

export function reopenClosedWindow(index = 0): { closedWindows: ClosedWindowEntry[] } {
  const session = sessionStore().get()
  const entry = session.closedWindows[index]
  if (!entry) return { closedWindows: session.closedWindows }
  const windowId = `float_${randomUUID().slice(0, 8)}`
  const tabs = entry.tabs.map((row) => {
    const id = freshTabId()
    return { ...row.tab, id, windowId }
  })
  const closedWindows = session.closedWindows.filter((_, i) => i !== index)
  sessionStore().set({
    ...session,
    tabs: [...session.tabs, ...tabs],
    explorerWindows: [
      ...session.explorerWindows,
      {
        id: windowId,
        kind: 'float' as const,
        bounds: entry.bounds,
        maximized: entry.maximized === true,
        activeTabId: tabs[0]?.id ?? null
      }
    ],
    closedWindows
  })
  const meta = sessionStore()
    .get()
    .explorerWindows.find((w) => w.id === windowId)
  if (meta) openFloat(meta)
  roster()
  return { closedWindows }
}

export function clearClosedWindows(): { closedWindows: ClosedWindowEntry[] } {
  const session = sessionStore().get()
  sessionStore().set({ ...session, closedWindows: [] })
  roster()
  return { closedWindows: [] }
}

export function saveFloatTabs(
  shellId: string,
  tabs: TabState[],
  activeTabId: string | null,
  closedTabs?: SessionState['closedTabs']
): void {
  if (shellId === MAIN_SHELL_ID || ignoreSessionWrites) return
  if (retiredShellIds.has(shellId) || allowClose.has(shellId) || !shells.has(shellId)) return
  const session = sessionStore().get()
  const merged = mergeFloatTabs(session, shellId, tabs, activeTabId)
  sessionStore().set(
    closedTabs
      ? { ...merged, closedTabs: closedTabs.slice(0, MAX_CLOSED_TABS) }
      : merged
  )
}

export function mergeAllFloatsIntoMain(): void {
  const session = sessionStore().get()
  sessionStore().set({
    ...session,
    tabs: session.tabs.map((t) =>
      tabWindowId(t) === MAIN_SHELL_ID ? t : { ...t, windowId: MAIN_SHELL_ID }
    ),
    explorerWindows: []
  })
  lockSessionWrites()
  for (const [id, win] of [...shells]) {
    if (id === MAIN_SHELL_ID) continue
    allowClose.add(id)
    retiredShellIds.add(id)
    if (!win.isDestroyed()) win.close()
  }
}

function frameOf(win: BrowserWindow): LayoutWindowFrame | null {
  if (win.isDestroyed() || win.isMinimized()) return null
  const maximized = win.isMaximized()
  const b = maximized ? win.getNormalBounds() : win.getBounds()
  if (!(b.width > 0) || !(b.height > 0)) return null
  return { x: b.x, y: b.y, width: b.width, height: b.height, maximized }
}

function applyFrame(win: BrowserWindow, frame: LayoutWindowFrame): void {
  if (win.isDestroyed()) return
  const bounds = {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.max(640, Math.round(frame.width)),
    height: Math.max(400, Math.round(frame.height))
  }
  if (win.isMaximized() && !frame.maximized) win.unmaximize()
  win.setBounds(bounds)
  if (frame.maximized && !win.isMaximized()) win.maximize()
}

function layoutTabFromState(tab: TabState): LayoutFloatWire['tabs'][number] {
  return layoutTabSchema.parse({
    path: tab.path,
    title: tab.title,
    icon: tab.icon,
    viewMode: tab.viewMode,
    sort: tab.sort,
    rootPath: tab.rootPath,
    treeExpanded: tab.treeExpanded,
    dropShortcut: tab.dropShortcut ?? null,
    dropTransfer: tab.dropTransfer ?? 'auto'
  })
}

function stateFromLayoutTab(
  tab: LayoutFloatWire['tabs'][number],
  id: string,
  windowId: string
): TabState {
  return {
    id,
    path: tab.path,
    title: tab.title,
    icon: tab.icon,
    viewMode: tab.viewMode,
    sort: tab.sort,
    historyBack: [],
    historyForward: [],
    search: { active: false, query: '', indexedOnly: false },
    selectedPaths: [],
    scrollOffset: 0,
    rootPath: tab.rootPath,
    treeExpanded: tab.treeExpanded,
    virtualFolderGroupStack: [],
    windowId,
    dropShortcut: tab.dropShortcut ?? null,
    dropTransfer: tab.dropTransfer ?? 'auto'
  }
}

export type LayoutWorkspaceCapture = {
  mainWindow: LayoutWindowFrame | null
  windows: LayoutFloatWire[]
}

/** Ask every other shell to write its tabs, then read live frames + float tabs. */
export function captureWorkspace(exceptShellId: string): Promise<LayoutWorkspaceCapture> {
  const pending = [...shells.keys()].filter((id) => {
    if (id === exceptShellId) return false
    const win = shells.get(id)
    return win != null && !win.isDestroyed()
  })
  const done = new Promise<void>((resolve) => {
    if (pending.length === 0) {
      resolve()
      return
    }
    const left = new Set(pending)
    const timer = setTimeout(() => {
      for (const id of left) flushWaiters.delete(id)
      resolve()
    }, 1500)
    for (const id of pending) {
      flushWaiters.set(id, () => {
        left.delete(id)
        flushWaiters.delete(id)
        if (left.size === 0) {
          clearTimeout(timer)
          resolve()
        }
      })
      const win = shells.get(id)
      if (win) sendToWindow(win, { type: 'shell-layout-flush' })
    }
  })
  return done.then(() => {
    const session = sessionStore().get()
    const mainWin = shells.get(MAIN_SHELL_ID)
    const mainWindow = mainWin ? frameOf(mainWin) : null
    const windows: LayoutFloatWire[] = []
    for (const meta of session.explorerWindows) {
      const tabs = session.tabs.filter((t) => tabWindowId(t) === meta.id)
      if (tabs.length === 0) continue
      const live = shells.get(meta.id)
      const frame =
        (live ? frameOf(live) : null) ??
        (meta.bounds
          ? {
              x: meta.bounds.x,
              y: meta.bounds.y,
              width: meta.bounds.width,
              height: meta.bounds.height,
              maximized: meta.maximized === true
            }
          : null)
      if (!frame) continue
      const activeIdx = tabs.findIndex((t) => t.id === meta.activeTabId)
      windows.push({
        frame,
        activeTabIndex: activeIdx >= 0 ? activeIdx : 0,
        tabs: tabs.map(layoutTabFromState)
      })
    }
    return { mainWindow, windows }
  })
}

export function ackLayoutFlush(shellId: string): void {
  flushWaiters.get(shellId)?.()
}

export function forwardLayoutToMain(req: {
  op: 'saveLayout' | 'updateLayout' | 'applyLayout'
  name?: string
  id?: string
}): Promise<{ layout: unknown | null }> {
  const main = shells.get(MAIN_SHELL_ID)
  if (!main || main.isDestroyed()) return Promise.resolve({ layout: null })
  if (req.op !== 'saveLayout') {
    sendToWindow(main, {
      type: 'shell-layout-op',
      payload: { op: req.op, name: req.name, id: req.id }
    })
    return Promise.resolve({ layout: null })
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      layoutOpWaiter = null
      resolve({ layout: null })
    }, 8000)
    layoutOpWaiter = (layout) => {
      clearTimeout(timer)
      layoutOpWaiter = null
      resolve({ layout })
    }
    sendToWindow(main, {
      type: 'shell-layout-op',
      payload: { op: req.op, name: req.name, id: req.id }
    })
  })
}

export function completeLayoutOp(layout: unknown): void {
  layoutOpWaiter?.(layout)
}

/**
 * Close every float (not recorded as a recently closed window) and open the
 * layout's secondary windows. Main-shell tabs already in the session are kept.
 */
export function replaceLayoutWindows(
  mainWindow: LayoutWindowFrame | null,
  windows: LayoutFloatWire[]
): { ok: true } {
  for (const [id, win] of [...shells]) {
    if (id === MAIN_SHELL_ID) continue
    retiredShellIds.add(id)
    allowClose.add(id)
    if (!win.isDestroyed()) win.close()
  }
  const session = sessionStore().get()
  const mainTabs = session.tabs.filter((t) => tabWindowId(t) === MAIN_SHELL_ID)
  const explorerWindows: ExplorerWindowState[] = []
  const floatTabs: TabState[] = []
  for (const spec of windows) {
    const windowId = `float_${randomUUID().slice(0, 8)}`
    const tabs = spec.tabs.map((t) => stateFromLayoutTab(t, freshTabId(), windowId))
    const active = tabs[Math.min(spec.activeTabIndex, tabs.length - 1)]
    floatTabs.push(...tabs)
    explorerWindows.push({
      id: windowId,
      kind: 'float',
      bounds: {
        x: spec.frame.x,
        y: spec.frame.y,
        width: spec.frame.width,
        height: spec.frame.height
      },
      maximized: spec.frame.maximized === true,
      activeTabId: active?.id ?? null
    })
  }
  sessionStore().set({
    ...session,
    tabs: [...mainTabs, ...floatTabs],
    explorerWindows
  })
  for (const meta of explorerWindows) openFloat(meta)
  const main = shells.get(MAIN_SHELL_ID)
  if (main && mainWindow) applyFrame(main, mainWindow)
  return { ok: true as const }
}
