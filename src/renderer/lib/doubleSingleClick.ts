/**
 * “Double single-click” (two slow clicks) — Explorer-style rename arming.
 *
 * Call on each name-label click of a sole-selected item:
 * - **First** click → arm only (never rename from dwell / hover).
 * - **Second** click after `DOUBLE_SINGLE_CLICK_MS` → fire `onFire` immediately.
 * - **Second** click inside that window → cancel (real double-click opens / expands).
 *
 * Fast double-click still wins via `cancelDoubleSingleClick` from `onDoubleClick`.
 */

/** Slightly above the common Windows default double-click time (500ms). */
export const DOUBLE_SINGLE_CLICK_MS = 550
export const DOUBLE_SINGLE_CLICK_MOVE_PX = 6

type Session = {
  key: string
  x: number
  y: number
  armedAt: number
  cancel: () => void
}

let session: Session | null = null

type Host = {
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
  addEventListener?: typeof window.addEventListener
  removeEventListener?: typeof window.removeEventListener
  now: () => number
}

function host(): Host {
  const g = globalThis as unknown as {
    setTimeout: typeof setTimeout
    clearTimeout: typeof clearTimeout
    addEventListener?: typeof window.addEventListener
    removeEventListener?: typeof window.removeEventListener
  }
  return {
    setTimeout: g.setTimeout,
    clearTimeout: g.clearTimeout,
    addEventListener: g.addEventListener,
    removeEventListener: g.removeEventListener,
    // Date.now so tests can advance with vi.setSystemTime / fake timers.
    now: () => Date.now()
  }
}

export function cancelDoubleSingleClick(): void {
  session?.cancel()
  session = null
}

function sameKey(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase()
}

/**
 * Note a name-label click for rename arming.
 * @param key Stable item id (usually absolute path) so arms don’t cross files.
 */
export function beginDoubleSingleClick(
  clientX: number,
  clientY: number,
  key: string,
  onFire: () => void
): void {
  const h = host()
  const now = h.now()

  if (session && sameKey(session.key, key)) {
    const dt = now - session.armedAt
    cancelDoubleSingleClick()
    if (dt < DOUBLE_SINGLE_CLICK_MS) {
      // Within double-click window — open/expand owns this gesture.
      return
    }
    onFire()
    return
  }

  cancelDoubleSingleClick()

  let done = false
  const cleanup = (): void => {
    h.removeEventListener?.('pointermove', onMove, true)
    h.removeEventListener?.('pointerdown', onPtrDown, true)
    h.removeEventListener?.('keydown', onKey, true)
    h.removeEventListener?.('blur', onBlur)
    h.removeEventListener?.('scroll', onScroll, true)
    h.removeEventListener?.('wheel', onScroll, true)
  }

  const cancel = (): void => {
    if (done) return
    done = true
    cleanup()
    if (session?.cancel === cancel) session = null
  }

  const onMove = (e: Event): void => {
    const pe = e as PointerEvent
    if (typeof pe.clientX !== 'number') return
    if (Math.hypot(pe.clientX - clientX, pe.clientY - clientY) > DOUBLE_SINGLE_CLICK_MOVE_PX) {
      cancel()
    }
  }
  /** Clicks on non-name chrome cancel the arm; name labels may be the second click. */
  const onPtrDown = (e: Event): void => {
    if (isNameLabelTarget(e.target)) return
    cancel()
  }
  const onKey = (e: Event): void => {
    const ke = e as KeyboardEvent
    if (ke.key === 'Escape' || ke.key === 'Enter' || ke.key.length === 1) cancel()
  }
  const onBlur = (): void => cancel()
  const onScroll = (): void => cancel()

  h.addEventListener?.('pointermove', onMove, true)
  h.addEventListener?.('pointerdown', onPtrDown, true)
  h.addEventListener?.('keydown', onKey, true)
  h.addEventListener?.('blur', onBlur)
  h.addEventListener?.('scroll', onScroll, true)
  h.addEventListener?.('wheel', onScroll, true)

  session = { key, x: clientX, y: clientY, armedAt: now, cancel }
}

/** True when the event target is a file/folder name label (not icon/twisty). */
export function isNameLabelTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as { closest?: (sel: string) => unknown }
  if (typeof el.closest !== 'function') return false
  return Boolean(el.closest('.cell-name, .cell-name-primary, .row-name-text, .tree-label'))
}
