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
/** Long enough to allow a user to pause before clicking to rename, but not keep the arm forever. */
export const DOUBLE_SINGLE_CLICK_MAX_MS = 10_000
export const DOUBLE_SINGLE_CLICK_MOVE_PX = 6

type Session = {
  key: string
  x: number
  y: number
  armedAt: number
  cancel: () => void
  timeoutId: ReturnType<typeof setTimeout>
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
    setTimeout: g.setTimeout.bind(g),
    clearTimeout: g.clearTimeout.bind(g),
    addEventListener: g.addEventListener?.bind(g),
    removeEventListener: g.removeEventListener?.bind(g),
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
    if (session?.cancel === cancel) {
      if (session.timeoutId) h.clearTimeout(session.timeoutId)
      session = null
    }
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

  const timeoutId = h.setTimeout(cancel, DOUBLE_SINGLE_CLICK_MAX_MS)
  session = { key, x: clientX, y: clientY, armedAt: now, cancel, timeoutId }
}

/** True when the event target is a file/folder name label (not icon/twisty). */
export function isNameLabelTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  let node = target as Node | null
  while (node && node.nodeType !== Node.ELEMENT_NODE) {
    node = node.parentNode
  }
  if (!node || !(node instanceof Element)) return false
  if (node.closest('.tab-close, .tab-rename-input')) return false
  return Boolean(
    node.closest('.cell-name, .cell-name-primary, .row-name-text, .tree-label, .tab-title, .tab')
  )
}
