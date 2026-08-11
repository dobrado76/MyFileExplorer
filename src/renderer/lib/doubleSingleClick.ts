/**
 * Windows Explorer–style label rename (since ~Win95):
 *
 * 1. Single-click an item → **select only** (`noteItemClick`).
 * 2. Wait longer than the double-click interval (so open isn’t pending).
 * 3. Single-click the **name label** again → arm a hover timer (~500ms).
 * 4. If the pointer stays put until the timer fires → start rename.
 *    Double-click / move / click elsewhere / Esc cancels.
 *
 * A lone click on an already-selected name does **not** rename — that click is
 * only the “first click” (select/arm). Rename needs the slow second click.
 */

/** Typical Windows GetDoubleClickTime() default. */
export const DOUBLE_SINGLE_CLICK_MS = 500

/** Cancel pending rename if the pointer moves farther than this (Explorer-ish). */
const RENAME_MOVE_CANCEL_PX = 4

type LastClick = { key: string; at: number }

let lastClick: LastClick | null = null
let renameTimer: ReturnType<typeof setTimeout> | null = null
let pendingRenameKey: string | null = null
let moveUnsub: (() => void) | null = null
/** Ignore label-rename arming until this timestamp (dismiss-click after rename). */
let suppressRenameUntil = 0

function now(): number {
  return Date.now()
}

function sameKey(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase()
}

function clearMoveWatch(): void {
  if (moveUnsub) {
    moveUnsub()
    moveUnsub = null
  }
}

function clearPendingRename(): void {
  if (renameTimer != null) {
    clearTimeout(renameTimer)
    renameTimer = null
  }
  pendingRenameKey = null
  clearMoveWatch()
}

/** Clear rename timing / pending rename (e.g. on double-click / context menu / drag). */
export function cancelDoubleSingleClick(): void {
  lastClick = null
  clearPendingRename()
  suppressRenameUntil = 0
}

/**
 * Block scheduling a new label-rename for a short window (click-away ending rename
 * must not immediately re-enter rename or fight the restored icon+label layout).
 */
export function suppressLabelRenameBriefly(ms: number = DOUBLE_SINGLE_CLICK_MS + 50): void {
  suppressRenameUntil = now() + ms
  clearPendingRename()
}

/**
 * Record a click/selection on an item. Call from pointerdown when selecting,
 * and from non-rename clicks, so the select gesture counts as the “first click”.
 * Also cancels any pending scheduled rename.
 */
export function noteItemClick(key: string): void {
  clearPendingRename()
  lastClick = { key, at: now() }
}

/**
 * True when this label click may arm rename: same item was noted earlier and
 * enough time has passed that this is not part of a double-click.
 */
export function isSlowSecondLabelClick(key: string): boolean {
  if (now() < suppressRenameUntil) return false
  if (!lastClick || !sameKey(lastClick.key, key)) return false
  return now() - lastClick.at >= DOUBLE_SINGLE_CLICK_MS
}

/**
 * After a valid slow second label click: wait ~half a second (hover) then rename.
 * Cancels if the pointer moves, or on `cancelDoubleSingleClick`.
 */
export function scheduleLabelRename(
  key: string,
  onFire: () => void,
  clientX?: number,
  clientY?: number
): void {
  if (now() < suppressRenameUntil) {
    lastClick = { key, at: now() }
    return
  }
  clearPendingRename()
  // This click is the “second click” — refresh timing so a triple-click doesn’t
  // immediately re-arm another rename.
  lastClick = { key, at: now() }
  pendingRenameKey = key
  const originX = clientX ?? 0
  const originY = clientY ?? 0
  const watchMove = clientX != null && clientY != null

  if (watchMove && typeof window !== 'undefined') {
    const onMove = (e: PointerEvent): void => {
      const dx = e.clientX - originX
      const dy = e.clientY - originY
      if (dx * dx + dy * dy > RENAME_MOVE_CANCEL_PX * RENAME_MOVE_CANCEL_PX) {
        clearPendingRename()
        // Keep lastClick so the user can try again after another pause + click.
      }
    }
    window.addEventListener('pointermove', onMove, true)
    moveUnsub = () => window.removeEventListener('pointermove', onMove, true)
  }

  renameTimer = setTimeout(() => {
    renameTimer = null
    const pending = pendingRenameKey
    clearMoveWatch()
    pendingRenameKey = null
    if (now() < suppressRenameUntil) return
    if (pending && sameKey(pending, key)) onFire()
  }, DOUBLE_SINGLE_CLICK_MS)
}

/**
 * Label click on a sole-selected item.
 * - Too soon after select / no prior note → treat as first click (note only).
 * - Slow second click on the label → schedule rename after hover wait.
 * Returns true if a rename timer was armed.
 */
export function handleLabelClickForRename(
  key: string,
  onFire: () => void,
  clientX?: number,
  clientY?: number
): boolean {
  if (now() < suppressRenameUntil) {
    noteItemClick(key)
    return false
  }
  if (isSlowSecondLabelClick(key)) {
    scheduleLabelRename(key, onFire, clientX, clientY)
    return true
  }
  // First click (or within the double-click window): select/arm only.
  noteItemClick(key)
  return false
}

/**
 * @deprecated Prefer `handleLabelClickForRename`.
 */
export function tryLabelRenameClick(key: string): boolean {
  return isSlowSecondLabelClick(key)
}

/**
 * @deprecated Prefer `noteItemClick` + `handleLabelClickForRename`.
 */
export function beginLabelRenameWatch(
  key: string,
  onFire: () => void,
  clientX?: number,
  clientY?: number
): void {
  handleLabelClickForRename(key, onFire, clientX, clientY)
}

/** @deprecated Alias of beginLabelRenameWatch. */
export function beginDoubleSingleClick(
  clientX: number,
  clientY: number,
  key: string,
  onFire: () => void
): void {
  handleLabelClickForRename(key, onFire, clientX, clientY)
}

/** True when the event target is a file/folder name label (not icon/twisty). */
export function isNameLabelTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as { closest?: (sel: string) => Element | null }
  if (typeof el.closest !== 'function') return false
  if (el.closest('.twisty, .shell-icon')) return false
  return Boolean(
    el.closest('.cell-name, .cell-name-primary, .row-name-text, .tree-label')
  )
}
