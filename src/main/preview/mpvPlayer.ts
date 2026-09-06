/**
 * Opt-in Rich player (D33): spawn mpv, then park it as a borderless owned
 * overlay over the preview host (not --wid / not WS_CHILD — Electron GPU
 * blanks those). Only used for containers without a Chromium mediaUrl.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { BrowserWindow, type WebContents } from 'electron'
import { AppError } from '@shared/result'
import type { PreviewMpvBounds } from '@shared/schemas/preview'
import { logMain } from '../logging'
import { ensureMpvOscScript, resolveMpvPath } from './mpvBin'
import {
  findMpvWindow,
  moveMpvOverlay,
  overlayGeometryArg,
  placeMpvOverlay,
  screenRectFor
} from './mpvSurfaceWin32'

let titleSeq = 0
/** Monotonic token so a superseded start cannot install or orphan a session. */
let sessionGeneration = 0

type Session = {
  generation: number
  filePath: string
  ownerId: number
  /** Null while waiting for the mpv HWND. */
  mpvHwnd: unknown | null
  child: ChildProcess
  lastRel: PreviewMpvBounds
  moveHandler: () => void
  resizeHandler: () => void
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
  }
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
  autoplay: boolean
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
  const args = [
    '--no-terminal',
    '--force-window=immediate',
    '--force-window-position=yes',
    '--keep-open=yes',
    '--no-border',
    '--keepaspect-window=no',
    '--osc=yes',
    '--script-opts=osc-visibility=always,osc-windowcontrols=no,osc-layout=bottombar',
    `--script=${oscScript}`,
    '--cursor-autohide=no',
    '--input-default-bindings=yes',
    '--input-vo-keyboard=yes',
    `--title=${title}`,
    '--vo=gpu',
    '--hwdec=auto-safe',
    overlayGeometryArg(spawnRect),
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
    moveMpvOverlay(owner, session.mpvHwnd, session.lastRel)
  }

  // Provisional session immediately so concurrent stop/start can kill this child.
  session = {
    generation,
    filePath: resolved,
    ownerId: owner.id,
    mpvHwnd: null,
    child,
    lastRel: { ...bounds },
    moveHandler,
    resizeHandler: moveHandler
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

  session.mpvHwnd = mpvHwnd

  // File-open can still nudge the VO once; re-assert the host rect.
  for (const ms of [50, 160, 400]) {
    setTimeout(() => {
      if (!stillCurrent(generation) || !session?.mpvHwnd) return
      if (owner.isDestroyed()) return
      moveMpvOverlay(owner, session.mpvHwnd, session.lastRel)
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
  moveMpvOverlay(owner, cur.mpvHwnd, bounds)
  return { ok: true }
}

/** Stop only when `sender` is the exact owner of the active session. */
export function stopMpvForSender(sender: WebContents): { stopped: boolean } {
  if (!session) return { stopped: false }
  const ownerId = ownerWindowId(sender)
  if (ownerId === null || ownerId !== session.ownerId) return { stopped: false }
  return stopMpvSession()
}
