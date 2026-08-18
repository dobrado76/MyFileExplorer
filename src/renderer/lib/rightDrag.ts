import {
  startDragAutoScroll,
  stopDragAutoScroll,
  updateDragAutoScrollPointer
} from './dragAutoScroll'
import { samePath, isUnderPath } from './paths'
import { isVolumeRootPath } from '@shared/paths'

export { isVolumeRootPath }

const THRESHOLD_PX = 5

export type RightDragSession = {
  paths: string[]
  startX: number
  startY: number
  active: boolean
}

/** True when `dest` is a legal drop folder for these sources (not self / not under a source). */
export function isValidDropDest(paths: string[], dest: string): boolean {
  if (!dest || paths.length === 0) return false
  return !paths.some((p) => samePath(p, dest) || isUnderPath(dest, p))
}

/**
 * Resolve `data-drop-dir` under the pointer (file view / tree / pane chrome).
 * Walks `elementsFromPoint` so the drag ghost and stacked panes don’t hide targets.
 */
export function findDropDirAt(clientX: number, clientY: number): string | null {
  const stack =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : (() => {
          const el = document.elementFromPoint(clientX, clientY)
          return el ? [el] : []
        })()
  for (const el of stack) {
    if (!(el instanceof Element)) continue
    if (el.id === 'mfe-right-drag-ghost') continue
    const hit = el.closest('[data-drop-dir]')
    if (!hit || !(hit instanceof HTMLElement)) continue
    const dest = hit.dataset['dropDir'] ?? hit.getAttribute('data-drop-dir')
    if (dest && dest.length > 0) return dest
  }
  return null
}

export function createRightDragSession(
  paths: string[],
  clientX: number,
  clientY: number
): RightDragSession {
  return { paths: [...paths], startX: clientX, startY: clientY, active: false }
}

/** Activate once the pointer moves past the Explorer-like drag threshold. */
export function updateRightDragActive(
  session: RightDragSession,
  clientX: number,
  clientY: number
): boolean {
  if (session.active) return true
  const dx = clientX - session.startX
  const dy = clientY - session.startY
  if (dx * dx + dy * dy < THRESHOLD_PX * THRESHOLD_PX) return false
  session.active = true
  return true
}

/** After a right-drag, suppress the normal contextmenu that fires on mouseup. */
let suppressContextMenuUntil = 0

export function armContextMenuSuppress(ms = 750): void {
  suppressContextMenuUntil = Math.max(suppressContextMenuUntil, Date.now() + ms)
}

export function shouldSuppressContextMenu(): boolean {
  return Date.now() < suppressContextMenuUntil
}

/** Live right-drag (file view or tree) — used to ignore leftover contextmenu events. */
let liveRightDrag: RightDragSession | null = null

export function getLiveRightDragSession(): RightDragSession | null {
  return liveRightDrag
}

const GHOST_ID = 'mfe-right-drag-ghost'

/** Floating label that follows the cursor during an active right-drag. */
export function showRightDragGhost(label: string, clientX: number, clientY: number): void {
  let ghost = document.getElementById(GHOST_ID)
  if (!ghost) {
    ghost = document.createElement('div')
    ghost.id = GHOST_ID
    ghost.className = 'right-drag-ghost'
    document.body.appendChild(ghost)
  }
  ghost.textContent = label
  ghost.style.left = `${clientX + 14}px`
  ghost.style.top = `${clientY + 14}px`
}

export function hideRightDragGhost(): void {
  document.getElementById(GHOST_ID)?.remove()
}

export function clearRightDragBodyClass(): void {
  document.body.classList.remove('right-dragging')
  hideRightDragGhost()
}

export type RightDragGestureHandlers = {
  ghostLabel: string
  /** Called once when the gesture crosses the drag threshold. */
  onActivated: (paths: string[]) => void
  /** Highlight drop target under the pointer (null = none). */
  onHighlight: (dest: string | null) => void
  /**
   * Pointer released.
   * - `active: false` → treat as a plain right-click (open normal context menu).
   * - `active: true` + valid dest → open Copy/Move/Create shortcuts drop menu.
   */
  onFinish: (info: {
    active: boolean
    paths: string[]
    clientX: number
    clientY: number
    dest: string | null
  }) => void
  onCancel: () => void
}

/**
 * Capture pointer + window listeners for an Explorer-style right-button drag.
 * Caller must have already called preventDefault on the pointerdown.
 */
export function beginRightDragGesture(
  paths: string[],
  clientX: number,
  clientY: number,
  target: Element,
  pointerId: number,
  handlers: RightDragGestureHandlers
): void {
  const session = createRightDragSession(paths, clientX, clientY)
  liveRightDrag = session
  let notifiedActivate = false

  try {
    ;(target as HTMLElement).setPointerCapture(pointerId)
  } catch {
    /* ignore */
  }

  const onMove = (ev: PointerEvent | MouseEvent): void => {
    if (!liveRightDrag || liveRightDrag !== session) return
    if (!updateRightDragActive(session, ev.clientX, ev.clientY)) return
    if (!session.active) return
    if (!notifiedActivate) {
      notifiedActivate = true
      handlers.onActivated(session.paths)
      document.body.classList.add('right-dragging')
      startDragAutoScroll(ev.clientX, ev.clientY)
    }
    updateDragAutoScrollPointer(ev.clientX, ev.clientY)
    showRightDragGhost(handlers.ghostLabel, ev.clientX, ev.clientY)
    const dest = findDropDirAt(ev.clientX, ev.clientY)
    handlers.onHighlight(dest && isValidDropDest(session.paths, dest) ? dest : null)
  }

  const cleanup = (): void => {
    stopDragAutoScroll()
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('mousemove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('mouseup', onUp, true)
    window.removeEventListener('pointerdown', onOppDown, true)
    window.removeEventListener('mousedown', onOppDown, true)
    window.removeEventListener('pointercancel', onCancel, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('contextmenu', onCtx, true)
  }

  const endVisuals = (): void => {
    clearRightDragBodyClass()
    handlers.onHighlight(null)
  }

  const onUp = (ev: PointerEvent | MouseEvent): void => {
    if (!('button' in ev) || ev.button !== 2) return
    if (liveRightDrag !== session) return
    cleanup()
    liveRightDrag = null
    endVisuals()
    armContextMenuSuppress()
    const dest = findDropDirAt(ev.clientX, ev.clientY)
    handlers.onFinish({
      active: session.active,
      paths: session.paths,
      clientX: ev.clientX,
      clientY: ev.clientY,
      dest: dest && isValidDropDest(session.paths, dest) ? dest : null
    })
  }

  const onCancel = (): void => {
    if (liveRightDrag !== session) return
    cleanup()
    liveRightDrag = null
    endVisuals()
    armContextMenuSuppress()
    handlers.onCancel()
  }

  /** Explorer: opposite mouse button cancels the drag (right-drag → left cancels). */
  const onOppDown = (ev: PointerEvent | MouseEvent): void => {
    if (!('button' in ev) || ev.button !== 0) return
    if (liveRightDrag !== session) return
    ev.preventDefault()
    ev.stopPropagation()
    onCancel()
  }

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return
    onCancel()
  }

  const onCtx = (ev: Event): void => {
    if (!session.active && !shouldSuppressContextMenu()) return
    ev.preventDefault()
    ev.stopPropagation()
    armContextMenuSuppress()
  }

  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('mousemove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('mouseup', onUp, true)
  window.addEventListener('pointerdown', onOppDown, true)
  window.addEventListener('mousedown', onOppDown, true)
  window.addEventListener('pointercancel', onCancel, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('contextmenu', onCtx, true)
}
