/**
 * “Double single-click” (slow second click) — Explorer-style rename arming.
 *
 * After a second single-click on an already-selected name, fire `onFire` once
 * the system double-click window has passed. A real (fast) double-click cancels
 * via pointerdown / cancelDoubleSingleClick so open / expand still win.
 */

/** Slightly above the common Windows default double-click time (500ms). */
export const DOUBLE_SINGLE_CLICK_MS = 550
export const DOUBLE_SINGLE_CLICK_MOVE_PX = 6

type Session = { cancel: () => void }

let session: Session | null = null

type Host = {
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
  addEventListener?: typeof window.addEventListener
  removeEventListener?: typeof window.removeEventListener
  queueMicrotask?: typeof queueMicrotask
}

function host(): Host {
  return globalThis as unknown as Host
}

export function cancelDoubleSingleClick(): void {
  session?.cancel()
  session = null
}

export function beginDoubleSingleClick(
  clientX: number,
  clientY: number,
  onFire: () => void
): void {
  cancelDoubleSingleClick()

  const h = host()
  let done = false
  const timer = h.setTimeout(() => finish(true), DOUBLE_SINGLE_CLICK_MS)

  const cleanup = (): void => {
    h.clearTimeout(timer)
    h.removeEventListener?.('pointermove', onMove, true)
    h.removeEventListener?.('pointerdown', onPtrDown, true)
    h.removeEventListener?.('keydown', onKey, true)
    h.removeEventListener?.('blur', onBlur)
    h.removeEventListener?.('scroll', onScroll, true)
    h.removeEventListener?.('wheel', onScroll, true)
  }

  const finish = (fire: boolean): void => {
    if (done) return
    done = true
    cleanup()
    if (session?.cancel === cancel) session = null
    if (fire) onFire()
  }

  const cancel = (): void => finish(false)

  const onMove = (e: Event): void => {
    const pe = e as PointerEvent
    if (typeof pe.clientX !== 'number') return
    if (Math.hypot(pe.clientX - clientX, pe.clientY - clientY) > DOUBLE_SINGLE_CLICK_MOVE_PX) {
      cancel()
    }
  }
  const onPtrDown = (): void => cancel()
  const onKey = (e: Event): void => {
    const ke = e as KeyboardEvent
    if (ke.key === 'Escape' || ke.key === 'Enter' || ke.key.length === 1) cancel()
  }
  const onBlur = (): void => cancel()
  const onScroll = (): void => cancel()

  h.addEventListener?.('pointermove', onMove, true)
  const schedule = h.queueMicrotask ?? ((fn: () => void) => void h.setTimeout(fn, 0))
  schedule(() => {
    if (!done) h.addEventListener?.('pointerdown', onPtrDown, true)
  })
  h.addEventListener?.('keydown', onKey, true)
  h.addEventListener?.('blur', onBlur)
  h.addEventListener?.('scroll', onScroll, true)
  h.addEventListener?.('wheel', onScroll, true)

  session = { cancel }
}

/** True when the event target is a file/folder name label (not icon/twisty). */
export function isNameLabelTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as { closest?: (sel: string) => unknown }
  if (typeof el.closest !== 'function') return false
  return Boolean(el.closest('.cell-name, .cell-name-primary, .row-name-text, .tree-label'))
}
