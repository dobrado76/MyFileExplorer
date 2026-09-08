/**
 * Opt-in Rich player (D33): spawn mpv, then park it as a borderless owned
 * overlay over the preview host (not --wid / not WS_CHILD — Electron GPU
 * blanks those). Only used for containers without a Chromium mediaUrl.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import { app, BrowserWindow, type Event, type WebContents } from 'electron'
import { AppError } from '@shared/result'
import type { PreviewMpvBounds } from '@shared/schemas/preview'
import { logMain } from '../logging'
import { ensureMpvOscScript, resolveMpvPath } from './mpvBin'
import {
  findMpvWindow,
  hideMpvOverlay,
  moveMpvOverlay,
  overlayGeometryArg,
  placeMpvOverlay,
  screenRectFor,
  showMpvOverlay
} from './mpvSurfaceWin32'

let titleSeq = 0
/** Monotonic token so a superseded start cannot install or orphan a session. */
let sessionGeneration = 0

const MPV_IPC_PIPE = `\\\\.\\pipe\\mfe-mpv-${process.pid}`

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
  moveHandler: () => void
  resizeHandler: () => void
  minimizeHandler: () => void
  restoreHandler: () => void
  appFocusHandler: (event: Event, win: BrowserWindow) => void
}

let session: Session | null = null

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

/** Query live time-pos via mpv JSON IPC (before stop / for Now Playing handoff). */
export async function getMpvTimePos(): Promise<{ seconds: number | null }> {
  const cur = session
  if (!cur?.mpvHwnd) return { seconds: null }
  try {
    const seconds = await mpvIpcGetNumber(cur.ipcPipe, 'time-pos')
    return { seconds: seconds != null && Number.isFinite(seconds) ? Math.max(0, seconds) : null }
  } catch {
    return { seconds: null }
  }
}

function mpvIpcGetNumber(pipePath: string, property: string): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = net.connect(pipePath)
    let buf = ''
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(null)
    }, 400)
    socket.on('connect', () => {
      socket.write(JSON.stringify({ command: ['get_property', property] }) + '\n')
    })
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      const line = buf.split('\n').find((l) => l.trim().length > 0)
      if (!line) return
      clearTimeout(timer)
      socket.end()
      try {
        const parsed = JSON.parse(line) as { data?: unknown; error?: string }
        if (typeof parsed.data === 'number') resolve(parsed.data)
        else resolve(null)
      } catch {
        resolve(null)
      }
    })
    socket.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
  })
}

export function stopMpvSession(): { stopped: boolean } {
  const cur = session
  session = null
  // Invalidate in-flight starts so they cannot assign after we stop.
  sessionGeneration += 1
  if (!cur) return { stopped: false }
  detachOwnerListeners(cur)
  killChild(cur.child)
  return { stopped: true }
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

  // Tear down any live / provisional session, then claim a generation for this start.
  stopMpvSession()
  const generation = ++sessionGeneration

  titleSeq += 1
  // Literal title (no ${…} template) so FindWindowW can match it.
  const title = `MFE-RichPlayer-${process.pid}-${titleSeq}`

  const oscScript = ensureMpvOscScript()
  const spawnRect = screenRectFor(owner, bounds)
  const startArg =
    startAtSec != null && Number.isFinite(startAtSec) && startAtSec > 0.05
      ? [`--start=${startAtSec.toFixed(3)}`]
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
    `--input-ipc-server=${MPV_IPC_PIPE}`,
    `--title=${title}`,
    '--vo=gpu',
    '--hwdec=auto-safe',
    overlayGeometryArg(spawnRect),
    ...startArg,
    ...(autoplay ? [] : ['--pause']),
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
    ipcPipe: MPV_IPC_PIPE,
    lastRel: { ...bounds },
    chromeHidden: false,
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
