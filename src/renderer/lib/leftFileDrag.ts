import { api } from './ipc'
import {
  clearRightDragBodyClass,
  createRightDragSession,
  findDropDirAt,
  isValidDropDest,
  showRightDragGhost,
  updateRightDragActive,
  type RightDragSession
} from './rightDrag'

/**
 * Left-button file drag that keeps in-app drops working on Windows.
 *
 * Electron's `webContents.startDrag` (needed for CF_HDROP to other apps) steals
 * the gesture if called from HTML5 `dragstart`, so HTML5 drop targets never
 * fire. We use pointer capture for in-window moves/copies, and only call
 * `startDrag` when the pointer leaves this BrowserWindow.
 */

export type LeftDragHandlers = {
  ghostLabel: string
  onActivated: (paths: string[]) => void
  onHighlight: (dest: string | null) => void
  onDrop: (info: {
    paths: string[]
    dest: string | null
    ctrlKey: boolean
    shiftKey: boolean
  }) => void
  onCancel: () => void
}

let liveLeftDrag: RightDragSession | null = null
let suppressClickUntil = 0

export function getLiveLeftDragSession(): RightDragSession | null {
  return liveLeftDrag
}

/** After an activated left-drag, ignore the trailing click. */
export function armLeftDragClickSuppress(ms = 400): void {
  suppressClickUntil = Math.max(suppressClickUntil, Date.now() + ms)
}

export function shouldSuppressClickAfterLeftDrag(): boolean {
  return Date.now() < suppressClickUntil
}

function isPointerOutsideWindow(clientX: number, clientY: number): boolean {
  return (
    clientX < 0 ||
    clientY < 0 ||
    clientX >= window.innerWidth ||
    clientY >= window.innerHeight
  )
}

/**
 * Begin a left-button drag. Does not capture the pointer until the gesture
 * crosses the move threshold so click / double-click still work.
 */
export function beginLeftFileDragGesture(
  paths: string[],
  clientX: number,
  clientY: number,
  target: Element,
  pointerId: number,
  handlers: LeftDragHandlers
): void {
  if (paths.length === 0) return

  const session = createRightDragSession(paths, clientX, clientY)
  liveLeftDrag = session
  let activated = false
  let handedOff = false

  const cleanup = (): void => {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('mousemove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('mouseup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    window.removeEventListener('keydown', onKey, true)
  }

  const endVisuals = (): void => {
    clearRightDragBodyClass()
    handlers.onHighlight(null)
  }

  const releaseCapture = (): void => {
    try {
      ;(target as HTMLElement).releasePointerCapture(pointerId)
    } catch {
      /* ignore */
    }
  }

  const handoffToOs = (): void => {
    if (handedOff || !session.active) return
    handedOff = true
    cleanup()
    liveLeftDrag = null
    endVisuals()
    releaseCapture()
    armLeftDragClickSuppress()
    try {
      // Blocks until the OS drag ends (CF_HDROP). No HTML5 drag is active.
      api.shell.startDrag({ paths: session.paths })
    } catch {
      /* external drop unavailable this gesture */
    }
    handlers.onCancel()
  }

  const onMove = (ev: PointerEvent | MouseEvent): void => {
    if (liveLeftDrag !== session || handedOff) return
    if (!updateRightDragActive(session, ev.clientX, ev.clientY)) return
    if (!session.active) return

    if (!activated) {
      activated = true
      try {
        ;(target as HTMLElement).setPointerCapture(pointerId)
      } catch {
        /* ignore */
      }
      handlers.onActivated(session.paths)
      document.body.classList.add('right-dragging')
      armLeftDragClickSuppress()
    }

    if (isPointerOutsideWindow(ev.clientX, ev.clientY)) {
      handoffToOs()
      return
    }

    showRightDragGhost(handlers.ghostLabel, ev.clientX, ev.clientY)
    const dest = findDropDirAt(ev.clientX, ev.clientY)
    handlers.onHighlight(dest && isValidDropDest(session.paths, dest) ? dest : null)
  }

  const onUp = (ev: PointerEvent | MouseEvent): void => {
    if (!('button' in ev) || ev.button !== 0) return
    if (liveLeftDrag !== session || handedOff) return
    cleanup()
    liveLeftDrag = null
    endVisuals()
    releaseCapture()

    if (!session.active) return

    armLeftDragClickSuppress()
    const dest = findDropDirAt(ev.clientX, ev.clientY)
    handlers.onDrop({
      paths: session.paths,
      dest: dest && isValidDropDest(session.paths, dest) ? dest : null,
      ctrlKey: ev.ctrlKey,
      shiftKey: ev.shiftKey
    })
  }

  const onCancel = (): void => {
    if (liveLeftDrag !== session || handedOff) return
    handedOff = true
    cleanup()
    liveLeftDrag = null
    endVisuals()
    releaseCapture()
    handlers.onCancel()
  }

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') onCancel()
  }

  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('mousemove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('mouseup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  window.addEventListener('keydown', onKey, true)
}
