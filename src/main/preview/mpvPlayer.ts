/**
 * Opt-in Rich player (D33): spawn mpv, then park it as a borderless owned
 * overlay over the preview host (not --wid / not WS_CHILD — Electron GPU
 * blanks those). Only used for containers without a Chromium mediaUrl.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import { app, BrowserWindow, screen, type Event, type WebContents } from 'electron'
import { AppError } from '@shared/result'
import { EVENT_CHANNEL, type MfeEvent } from '@shared/ipc/contract'
import type { PreviewMpvBounds } from '@shared/schemas/preview'
import { foldMpvPlaybackReplies, takeMpvIpcMessages } from '@shared/mpvIpc'
import { logMain } from '../logging'
import { ensureMpvOscScript, resolveMpvPath } from './mpvBin'
import {
  dipRectFor,
  findMpvWindow,
  hideMpvOverlay,
  hwndAtCursor,
  hwndIsMpvSurface,
  isLeftMouseDown,
  moveMpvOverlay,
  overlayGeometryArg,
  placeMpvOverlay,
  screenRectFor,
  showMpvOverlay
} from './mpvSurfaceWin32'
import { mpvDipClickIsVideoToggle } from '@shared/mpvClickPause'

let titleSeq = 0
/** Monotonic token so a superseded start cannot install or orphan a session. */
let sessionGeneration = 0

const MPV_IPC_PIPE_PREFIX = `\\\\.\\pipe\\mfe-mpv-${process.pid}`

type Session = {
  generation: number
  filePath: string
  ownerId: number
  /** Null while waiting for the mpv HWND. */
  mpvHwnd: unknown | null
  child: ChildProcess
  ipcPipe: string
  lastRel: PreviewMpvBounds
  /** Dialog / menu asked to hide the overlay without killing playback. */
  chromeHidden: boolean
  /** Poll cursor so idle chrome sees moves over the mpv overlay. */
  pointerWatchTimer: ReturnType<typeof setInterval> | null
  clickPauseTimer: ReturnType<typeof setInterval> | null
  clickPauseArmedAt: number
  lastLeftDown: boolean
  /** Detached / Now Playing hid the OSC via IPC. Docked stays false (bar always on). */
  oscHidden: boolean
  lastPointer: { x: number; y: number } | null
  moveHandler: () => void
  resizeHandler: () => void
  minimizeHandler: () => void
  restoreHandler: () => void
  appFocusHandler: (event: Event, win: BrowserWindow) => void
}

let session: Session | null = null
/** Skip video click-to-pause while Keep playing / Dock / pop-out reads time-pos. */
let playbackQueryDepth = 0
/** Applied on the next `startMpvSession` if the renderer omits `--start`. */
let resumeHint: { path: string; startAtSec: number; paused?: boolean } | null = null

/** Remember a resume offset so a remounted overlay cannot start at 0. */
export function setMpvResumeHint(
  filePath: string,
  opts?: { startAtSec?: number; paused?: boolean }
): void {
  const startAtSec = opts?.startAtSec
  const hasTime = startAtSec != null && Number.isFinite(startAtSec) && startAtSec > 0
  const hasPause = opts?.paused === true || opts?.paused === false
  if (!hasTime && !hasPause) {
    resumeHint = null
    return
  }
  resumeHint = {
    path: filePath,
    startAtSec: hasTime ? Math.max(0, startAtSec!) : 0,
    ...(hasPause ? { paused: opts!.paused } : {})
  }
}

function sameMpvPath(a: string, b: string): boolean {
  return a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase()
}

function consumeResumeHint(
  requested: string,
  resolved: string,
  startAtSec: number | undefined,
  autoplay: boolean
): { startAtSec: number | undefined; autoplay: boolean } {
  const hint = resumeHint
  if (!hint || (!sameMpvPath(hint.path, requested) && !sameMpvPath(hint.path, resolved))) {
    return { startAtSec, autoplay }
  }
  resumeHint = null
  const sec =
    startAtSec != null && Number.isFinite(startAtSec) && startAtSec > 0.05
      ? startAtSec
      : hint.startAtSec > 0.05
        ? hint.startAtSec
        : startAtSec
  const nextAutoplay =
    hint.paused === true ? false : hint.paused === false ? true : autoplay
  return { startAtSec: sec, autoplay: nextAutoplay }
}

function waitChildExit(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve()
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    child.once('exit', () => {
      clearTimeout(t)
      resolve()
    })
  })
}

function killChild(child: ChildProcess): void {
  if (child.killed) return
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
    } else {
      child.kill('SIGKILL')
    }
  } catch {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
  }
}

function detachOwnerListeners(cur: Session): void {
  const owner = BrowserWindow.fromId(cur.ownerId)
  if (owner && !owner.isDestroyed()) {
    owner.off('move', cur.moveHandler)
    owner.off('resize', cur.resizeHandler)
    owner.off('minimize', cur.minimizeHandler)
    owner.off('restore', cur.restoreHandler)
  }
  app.off('browser-window-focus', cur.appFocusHandler)
}

function stopPointerWatch(cur: Session): void {
  if (cur.pointerWatchTimer != null) {
    clearInterval(cur.pointerWatchTimer)
    cur.pointerWatchTimer = null
  }
  cur.lastPointer = null
}

function stopClickPauseWatch(cur: Session): void {
  if (cur.clickPauseTimer != null) {
    clearInterval(cur.clickPauseTimer)
    cur.clickPauseTimer = null
  }
}

/**
 * Video-picture left-click toggles pause (Chromium `<video>` parity).
 * Gate on mpv’s HWND so caption / header / drag-to-move never count.
 * Hit-test overlay in DIP — never mix `getCursorScreenPoint()` with physical `screenRectFor`.
 */
function startClickPauseWatch(cur: Session): void {
  stopClickPauseWatch(cur)
  cur.clickPauseArmedAt = Date.now() + 400
  cur.lastLeftDown = isLeftMouseDown()
  cur.clickPauseTimer = setInterval(() => {
    if (!session || session.generation !== cur.generation || !cur.mpvHwnd) {
      stopClickPauseWatch(cur)
      return
    }
    const down = isLeftMouseDown()
    const edge = down && !cur.lastLeftDown
    cur.lastLeftDown = down
    if (!edge || cur.chromeHidden) return
    if (playbackQueryDepth > 0) return
    if (Date.now() < cur.clickPauseArmedAt) return
    const owner = BrowserWindow.fromId(cur.ownerId)
    if (!owner || owner.isDestroyed() || owner.isMinimized()) return
    // Caption, in-page header, and other Electron chrome are not mpv.
    if (!hwndIsMpvSurface(hwndAtCursor(), cur.mpvHwnd)) return
    const pt = screen.getCursorScreenPoint()
    const overlay = dipRectFor(owner, cur.lastRel)
    if (!mpvDipClickIsVideoToggle(pt, overlay, !cur.oscHidden)) return
    mpvIpcCommand(cur.ipcPipe, ['cycle', 'pause'])
  }, 32)
}

function emitToOwner(cur: Session, event: MfeEvent): void {
  const owner = BrowserWindow.fromId(cur.ownerId)
  if (!owner || owner.isDestroyed()) return
  owner.webContents.send(EVENT_CHANNEL, event)
}

function startPointerWatch(cur: Session): void {
  stopPointerWatch(cur)
  cur.pointerWatchTimer = setInterval(() => {
    if (!session || session.generation !== cur.generation) {
      stopPointerWatch(cur)
      return
    }
    const owner = BrowserWindow.fromId(cur.ownerId)
    if (!owner || owner.isDestroyed() || owner.isMinimized()) return
    const pt = screen.getCursorScreenPoint()
    const b = owner.getBounds()
    const inside =
      pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height
    if (!inside) return
    if (cur.lastPointer && cur.lastPointer.x === pt.x && cur.lastPointer.y === pt.y) return
    cur.lastPointer = { x: pt.x, y: pt.y }
    emitToOwner(cur, { type: 'preview-mpv-pointer', payload: {} })
  }, 100)
}

export function stopMpvSession(): { stopped: boolean } {
  const cur = session
  session = null
  // Invalidate in-flight starts so they cannot assign after we stop.
  sessionGeneration += 1
  if (!cur) return { stopped: false }
  stopPointerWatch(cur)
  stopClickPauseWatch(cur)
  detachOwnerListeners(cur)
  killChild(cur.child)
  return { stopped: true }
}

/** Query live time-pos + pause via mpv JSON IPC (Now Playing / Dock / pop-out). */
export async function getMpvTimePos(): Promise<{
  seconds: number | null
  paused: boolean | null
}> {
  const cur = session
  if (!cur) return { seconds: null, paused: null }
  playbackQueryDepth += 1
  try {
    let result = await mpvIpcGetPlayback(cur.ipcPipe)
    if (result.seconds == null && session === cur) {
      result = await mpvIpcGetPlayback(cur.ipcPipe)
    }
    return result
  } catch {
    return { seconds: null, paused: null }
  } finally {
    playbackQueryDepth = Math.max(0, playbackQueryDepth - 1)
  }
}

/**
 * Wait for get_property replies. mpv emits events on every new IPC client; the
 * first line is often `{"event":...}` — treating that as time-pos yields null
 * and the detached player starts at 0.
 */
function mpvIpcGetPlayback(
  pipePath: string
): Promise<{ seconds: number | null; paused: boolean | null }> {
  const TIME_ID = 1
  const PAUSE_ID = 2
  return new Promise((resolve) => {
    const socket = net.connect(pipePath)
    let buf = ''
    const into = {
      seconds: null as number | null,
      paused: null as boolean | null,
      haveTime: false,
      havePause: false
    }
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve({ seconds: into.seconds, paused: into.paused })
    }
    const timer = setTimeout(finish, 700)
    socket.on('connect', () => {
      socket.write(
        JSON.stringify({ command: ['get_property', 'time-pos'], request_id: TIME_ID }) +
          '\n' +
          JSON.stringify({ command: ['get_property', 'pause'], request_id: PAUSE_ID }) +
          '\n'
      )
    })
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      const taken = takeMpvIpcMessages(buf)
      buf = taken.rest
      foldMpvPlaybackReplies(taken.messages, into, { time: TIME_ID, pause: PAUSE_ID })
      if (into.haveTime && into.havePause) finish()
    })
    socket.on('error', finish)
  })
}

/** Fire-and-forget mpv JSON IPC command (best-effort). */
function mpvIpcCommand(pipePath: string, command: unknown[]): void {
  const socket = net.connect(pipePath)
  const timer = setTimeout(() => socket.destroy(), 400)
  socket.on('connect', () => {
    socket.write(JSON.stringify({ command }) + '\n')
    socket.end()
  })
  socket.on('close', () => clearTimeout(timer))
  socket.on('error', () => {
    clearTimeout(timer)
  })
}

export function mpvProbe(): { available: boolean; path: string | null } {
  if (process.platform !== 'win32') return { available: false, path: null }
  const bin = resolveMpvPath()
  return { available: Boolean(bin), path: bin }
}

function ownerWindowId(sender: WebContents): number | null {
  const owner = BrowserWindow.fromWebContents(sender)
  if (!owner || owner.isDestroyed()) return null
  return owner.id
}

function stillCurrent(generation: number): boolean {
  return generation === sessionGeneration && session?.generation === generation
}

export async function startMpvSession(
  sender: WebContents,
  filePath: string,
  bounds: PreviewMpvBounds,
  autoplay: boolean,
  startAtSec?: number
): Promise<{ started: true }> {
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'Rich player (mpv) is only supported on Windows')
  }

  const bin = resolveMpvPath()
  if (!bin) {
    throw new AppError(
      'not-found',
      'mpv was not found. Install mpv or run npm run tools:fetch-mpv.',
      'Enable Rich player only after mpv is available (tools/mpv or PATH).'
    )
  }

  let resolved: string
  try {
    resolved = fs.realpathSync(filePath)
  } catch {
    throw new AppError('not-found', 'Video file not found', undefined, filePath)
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new AppError('not-found', 'Video path is not a file', undefined, filePath)
  }

  const owner = BrowserWindow.fromWebContents(sender)
  if (!owner || owner.isDestroyed()) {
    throw new AppError('io', 'No BrowserWindow for Rich player')
  }

  const resume = consumeResumeHint(filePath, resolved, startAtSec, autoplay)

  // Tear down any live / provisional session, then claim a generation for this start.
  const prevChild = session?.child ?? null
  stopMpvSession()
  if (prevChild) await waitChildExit(prevChild, 800)
  const generation = ++sessionGeneration
  const ipcPipe = `${MPV_IPC_PIPE_PREFIX}-${generation}`

  titleSeq += 1
  // Literal title (no ${…} template) so FindWindowW can match it.
  const title = `MFE-RichPlayer-${process.pid}-${titleSeq}`

  const oscScript = ensureMpvOscScript()
  const spawnRect = screenRectFor(owner, bounds)
  const startArg =
    resume.startAtSec != null && Number.isFinite(resume.startAtSec) && resume.startAtSec > 0.05
      ? [`--start=${resume.startAtSec.toFixed(3)}`]
      : []
  const args = [
    '--no-terminal',
    '--force-window=immediate',
    '--force-window-position=yes',
    '--keep-open=yes',
    '--no-border',
    '--keepaspect-window=no',
    '--no-ontop',
    '--osc=yes',
    '--script-opts=osc-visibility=always,osc-windowcontrols=no,osc-layout=bottombar',
    `--script=${oscScript}`,
    '--cursor-autohide=no',
    '--input-default-bindings=yes',
    '--input-vo-keyboard=yes',
    `--input-ipc-server=${ipcPipe}`,
    `--title=${title}`,
    '--vo=gpu',
    '--hwdec=auto-safe',
    overlayGeometryArg(spawnRect),
    ...startArg,
    ...(resume.autoplay ? [] : ['--pause']),
    resolved
  ]

  logMain('info', `mpv start (overlay) title=${title} gen=${generation}`)

  const child = spawn(bin, args, {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: false
  })

  if (!child.pid) {
    throw new AppError('io', 'mpv did not start (no pid)')
  }

  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
    if (stderr.length > 16_000) stderr = stderr.slice(-8_000)
  })

  const moveHandler = (): void => {
    if (!session || session.generation !== generation || owner.isDestroyed()) return
    if (!session.mpvHwnd) return
    moveMpvOverlay(owner, session.mpvHwnd, session.lastRel, {
      hide: session.chromeHidden || owner.isMinimized()
    })
  }

  const minimizeHandler = (): void => {
    if (!session || session.generation !== generation || !session.mpvHwnd) return
    hideMpvOverlay(session.mpvHwnd)
  }

  const restoreHandler = (): void => {
    if (!session || session.generation !== generation || !session.mpvHwnd) return
    if (session.chromeHidden) return
    showMpvOverlay(owner, session.mpvHwnd, session.lastRel)
  }

  const appFocusHandler = (_event: Event, win: BrowserWindow): void => {
    if (!session || session.generation !== generation || !session.mpvHwnd) return
    if (session.chromeHidden) return
    // Only re-show when the *owner* is focused (e.g. after a dialog hid the overlay).
    // Never hide on other MFE windows gaining focus — that blanks a still-visible
    // detached preview / Now Playing host while audio keeps playing.
    // Dialogs/menus already hide via setMpvVisible (chromeHidden); minimize uses hide.
    if (win.id !== session.ownerId) return
    if (!owner.isDestroyed() && !owner.isMinimized()) {
      showMpvOverlay(owner, session.mpvHwnd, session.lastRel)
    }
  }

  // Provisional session immediately so concurrent stop/start can kill this child.
  session = {
    generation,
    filePath: resolved,
    ownerId: owner.id,
    mpvHwnd: null,
    child,
    ipcPipe,
    lastRel: { ...bounds },
    chromeHidden: false,
    pointerWatchTimer: null,
    clickPauseTimer: null,
    clickPauseArmedAt: 0,
    lastLeftDown: false,
    oscHidden: false,
    lastPointer: null,
    moveHandler,
    resizeHandler: moveHandler,
    minimizeHandler,
    restoreHandler,
    appFocusHandler
  }

  let startFailed = false
  child.once('error', (e) => {
    logMain('warn', `mpv spawn error: ${String(e)}`)
    startFailed = true
  })
  child.once('exit', (code) => {
    if (code && code !== 0) {
      logMain('warn', `mpv exited code=${code} stderr=${stderr.slice(-800)}`)
      startFailed = true
    }
    // Only tear down a live overlay. During start, let find/place report the error.
    if (session?.generation === generation && session.mpvHwnd) stopMpvSession()
  })

  let mpvHwnd: unknown
  try {
    mpvHwnd = await findMpvWindow(title, child.pid, 5000)
  } catch (e) {
    if (session?.generation === generation) {
      stopMpvSession()
      throw new AppError(
        'io',
        `mpv window did not appear: ${e instanceof Error ? e.message : String(e)}. ${stderr.trim().slice(-300)}`
      )
    }
    killChild(child)
    throw new AppError('cancelled', 'Rich player start superseded')
  }

  if (!stillCurrent(generation)) {
    killChild(child)
    throw new AppError('cancelled', 'Rich player start superseded')
  }

  if (child.exitCode !== null || startFailed) {
    stopMpvSession()
    throw new AppError(
      'io',
      `mpv exited before overlay (code ${child.exitCode}). ${stderr.trim().slice(-400) || 'No stderr.'}`
    )
  }

  if (owner.isDestroyed()) {
    stopMpvSession()
    throw new AppError('io', 'Owner window closed while starting Rich player')
  }

  try {
    placeMpvOverlay(owner, mpvHwnd, session.lastRel)
    if (session.chromeHidden || owner.isMinimized()) hideMpvOverlay(mpvHwnd)
  } catch (e) {
    if (session?.generation === generation) {
      stopMpvSession()
      throw new AppError(
        'io',
        `Could not place mpv overlay: ${e instanceof Error ? e.message : String(e)}`
      )
    }
    killChild(child)
    throw new AppError('cancelled', 'Rich player start superseded')
  }

  if (!stillCurrent(generation)) {
    killChild(child)
    throw new AppError('cancelled', 'Rich player start superseded')
  }

  owner.on('move', moveHandler)
  owner.on('resize', moveHandler)
  owner.on('minimize', minimizeHandler)
  owner.on('restore', restoreHandler)
  app.on('browser-window-focus', appFocusHandler)

  session.mpvHwnd = mpvHwnd
  startClickPauseWatch(session)

  // File-open can still nudge the VO once; re-assert the host rect.
  for (const ms of [50, 160, 400]) {
    setTimeout(() => {
      if (!stillCurrent(generation) || !session?.mpvHwnd) return
      if (owner.isDestroyed()) return
      moveMpvOverlay(owner, session.mpvHwnd, session.lastRel, {
        hide: session.chromeHidden || owner.isMinimized()
      })
    }, ms)
  }

  return { started: true as const }
}

/** Move/resize only if `sender` owns the active session. */
export function setMpvBounds(sender: WebContents, bounds: PreviewMpvBounds): { ok: true } {
  const cur = session
  if (!cur) return { ok: true }
  const ownerId = ownerWindowId(sender)
  if (ownerId === null || ownerId !== cur.ownerId) return { ok: true }
  cur.lastRel = { ...bounds }
  if (!cur.mpvHwnd) return { ok: true }
  const owner = BrowserWindow.fromId(cur.ownerId)
  if (!owner || owner.isDestroyed()) return { ok: true }
  moveMpvOverlay(owner, cur.mpvHwnd, bounds, {
    hide: cur.chromeHidden || owner.isMinimized()
  })
  return { ok: true }
}

/** Hide/show the overlay without killing playback. Owner-scoped. */
export function setMpvVisible(sender: WebContents, visible: boolean): { ok: true } {
  const cur = session
  if (!cur) return { ok: true }
  const ownerId = ownerWindowId(sender)
  if (ownerId === null || ownerId !== cur.ownerId) return { ok: true }
  cur.chromeHidden = !visible
  if (!cur.mpvHwnd) return { ok: true }
  const owner = BrowserWindow.fromId(cur.ownerId)
  if (!owner || owner.isDestroyed()) return { ok: true }
  if (!visible || owner.isMinimized()) hideMpvOverlay(cur.mpvHwnd)
  else showMpvOverlay(owner, cur.mpvHwnd, cur.lastRel)
  return { ok: true }
}

/**
 * Show/hide mpv OSC for detached / Now Playing idle chrome.
 * Mouse hits Chromium, not mpv, so auto OSC mode cannot work — host drives this.
 */
export function setMpvOscVisible(sender: WebContents, visible: boolean): { ok: true } {
  const cur = session
  if (!cur?.mpvHwnd) return { ok: true }
  const ownerId = ownerWindowId(sender)
  if (ownerId === null || ownerId !== cur.ownerId) return { ok: true }
  cur.oscHidden = !visible
  mpvIpcCommand(cur.ipcPipe, [
    'script-message',
    'osc-visibility',
    visible ? 'always' : 'never',
    'no-osd'
  ])
  return { ok: true }
}

/** Cycle pause/play. Owner-scoped. Used when Chromium receives the click (detached). */
export function cycleMpvPause(sender: WebContents): { ok: true } {
  const cur = session
  if (!cur?.mpvHwnd) return { ok: true }
  const ownerId = ownerWindowId(sender)
  if (ownerId === null || ownerId !== cur.ownerId) return { ok: true }
  mpvIpcCommand(cur.ipcPipe, ['cycle', 'pause'])
  return { ok: true }
}

/**
 * Poll cursor over the owner BrowserWindow (including the mpv overlay) and
 * emit `preview-mpv-pointer` so idle chrome can wake on video-area moves.
 */
export function setMpvPointerWatch(sender: WebContents, enabled: boolean): { ok: true } {
  const cur = session
  if (!cur) return { ok: true }
  const ownerId = ownerWindowId(sender)
  if (ownerId === null || ownerId !== cur.ownerId) return { ok: true }
  if (enabled) startPointerWatch(cur)
  else stopPointerWatch(cur)
  return { ok: true }
}

/** Stop only when `sender` is the exact owner of the active session. */
export function stopMpvForSender(sender: WebContents): { stopped: boolean } {
  if (!session) return { stopped: false }
  const ownerId = ownerWindowId(sender)
  if (ownerId === null || ownerId !== session.ownerId) return { stopped: false }
  return stopMpvSession()
}

/** Stop if this BrowserWindow owns the active overlay (window closed / docked). */
export function stopMpvForWindowId(windowId: number): { stopped: boolean } {
  if (!session || session.ownerId !== windowId) return { stopped: false }
  return stopMpvSession()
}
