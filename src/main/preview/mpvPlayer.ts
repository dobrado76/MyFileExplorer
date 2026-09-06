/**
 * Opt-in Rich player (D33): spawn mpv, then park it as a borderless overlay
 * over the preview host. Only used for containers without a Chromium mediaUrl.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { BrowserWindow, type WebContents } from 'electron'
import { AppError } from '@shared/result'
import type { PreviewMpvBounds } from '@shared/schemas/preview'
import { logMain } from '../logging'
import { ensureMpvOscScript, resolveMpvPath } from './mpvBin'
import { findMpvWindow, moveMpvOverlay, placeMpvOverlay } from './mpvSurfaceWin32'

let titleSeq = 0

type Session = {
  filePath: string
  ownerId: number
  mpvHwnd: unknown
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

export function stopMpvSession(): { stopped: boolean } {
  const cur = session
  session = null
  if (!cur) return { stopped: false }

  const owner = BrowserWindow.fromId(cur.ownerId)
  if (owner && !owner.isDestroyed()) {
    owner.off('move', cur.moveHandler)
    owner.off('resize', cur.resizeHandler)
  }

  killChild(cur.child)
  return { stopped: true }
}

export function mpvProbe(): { available: boolean; path: string | null } {
  if (process.platform !== 'win32') return { available: false, path: null }
  const bin = resolveMpvPath()
  return { available: Boolean(bin), path: bin }
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

  stopMpvSession()

  titleSeq += 1
  // Literal title (no ${…} template) so FindWindowW can match it.
  const title = `MFE-RichPlayer-${process.pid}-${titleSeq}`

  const oscScript = ensureMpvOscScript()
  const args = [
    '--no-terminal',
    '--force-window=immediate',
    '--keep-open=yes',
    '--no-border',
    '--osc=yes',
    '--script-opts=osc-visibility=always,osc-windowcontrols=no,osc-layout=bottombar',
    `--script=${oscScript}`,
    '--cursor-autohide=no',
    '--input-default-bindings=yes',
    '--input-vo-keyboard=yes',
    `--title=${title}`,
    '--vo=gpu',
    '--hwdec=auto-safe',
    ...(autoplay ? [] : ['--pause']),
    resolved
  ]

  logMain('info', `mpv start (overlay) title=${title}`)

  const child = spawn(bin, args, {
    windowsHide: false,
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

  child.once('error', (e) => {
    logMain('warn', `mpv spawn error: ${String(e)}`)
    if (session?.child === child) stopMpvSession()
  })
  child.once('exit', (code) => {
    if (code && code !== 0) {
      logMain('warn', `mpv exited code=${code} stderr=${stderr.slice(-800)}`)
    }
    if (session?.child === child) stopMpvSession()
  })

  let mpvHwnd: unknown
  try {
    mpvHwnd = await findMpvWindow(title, child.pid, 5000)
  } catch (e) {
    killChild(child)
    throw new AppError(
      'io',
      `mpv window did not appear: ${e instanceof Error ? e.message : String(e)}. ${stderr.trim().slice(-300)}`
    )
  }

  if (child.exitCode !== null) {
    throw new AppError(
      'io',
      `mpv exited before overlay (code ${child.exitCode}). ${stderr.trim().slice(-400) || 'No stderr.'}`
    )
  }

  try {
    placeMpvOverlay(owner, mpvHwnd, bounds)
  } catch (e) {
    killChild(child)
    throw new AppError(
      'io',
      `Could not place mpv overlay: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  const moveHandler = (): void => {
    if (!session || owner.isDestroyed()) return
    moveMpvOverlay(owner, session.mpvHwnd, session.lastRel)
  }

  owner.on('move', moveHandler)
  owner.on('resize', moveHandler)

  session = {
    filePath: resolved,
    ownerId: owner.id,
    mpvHwnd,
    child,
    lastRel: { ...bounds },
    moveHandler,
    resizeHandler: moveHandler
  }

  return { started: true as const }
}

export function setMpvBounds(bounds: PreviewMpvBounds): { ok: true } {
  const cur = session
  if (!cur) return { ok: true }
  const owner = BrowserWindow.fromId(cur.ownerId)
  if (!owner || owner.isDestroyed()) return { ok: true }
  cur.lastRel = { ...bounds }
  moveMpvOverlay(owner, cur.mpvHwnd, bounds)
  return { ok: true }
}

export function stopMpvForSender(sender: WebContents): { stopped: boolean } {
  if (!session) return { stopped: false }
  const owner = BrowserWindow.fromWebContents(sender)
  if (owner && owner.id !== session.ownerId) return { stopped: false }
  return stopMpvSession()
}
