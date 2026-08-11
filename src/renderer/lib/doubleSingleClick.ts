/**
 * Explorer-style rename via a second click on the name label.
 *
 * Flow (Windows Explorer parity users expect):
 * 1. Click an item → select (recorded via `noteItemClick`).
 * 2. Wait longer than the double-click interval.
 * 3. Click the **name label** again → rename starts **immediately**.
 *
 * A second click inside the double-click window does **not** rename (open/expand
 * owns that gesture via `onDoubleClick` + `cancelDoubleSingleClick`).
 *
 * The click that first selects must call `noteItemClick` even when the React
 * `click` is suppressed after pointerdown selection.
 */

/** Typical Windows GetDoubleClickTime() default. */
export const DOUBLE_SINGLE_CLICK_MS = 500

type LastClick = { key: string; at: number }

let lastClick: LastClick | null = null

function now(): number {
  return Date.now()
}

function sameKey(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase()
}

/** Clear rename timing (e.g. on double-click / context menu / drag). */
export function cancelDoubleSingleClick(): void {
  lastClick = null
}

/**
 * Record a click/selection on an item. Call from pointerdown when selecting,
 * and from non-rename clicks, so the select gesture counts as the “first click”.
 */
export function noteItemClick(key: string): void {
  lastClick = { key, at: now() }
}

/**
 * Label click on a sole-selected item. Returns true → start rename now.
 * Returns false → inside double-click window (or consumed); do not rename.
 */
export function tryLabelRenameClick(key: string): boolean {
  const t = now()
  if (lastClick && sameKey(lastClick.key, key) && t - lastClick.at < DOUBLE_SINGLE_CLICK_MS) {
    lastClick = { key, at: t }
    return false
  }
  lastClick = { key, at: t }
  return true
}

/**
 * @deprecated Prefer `noteItemClick` + `tryLabelRenameClick`.
 * Kept so older call sites still compile; arms nothing — use the new API.
 */
export function beginLabelRenameWatch(
  key: string,
  onFire: () => void,
  _clientX?: number,
  _clientY?: number
): void {
  if (tryLabelRenameClick(key)) onFire()
}

/** @deprecated Alias of beginLabelRenameWatch. */
export function beginDoubleSingleClick(
  _clientX: number,
  _clientY: number,
  key: string,
  onFire: () => void
): void {
  if (tryLabelRenameClick(key)) onFire()
}

/** True when the event target is a file/folder name label (not icon/twisty). */
export function isNameLabelTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as { closest?: (sel: string) => Element | null }
  if (typeof el.closest !== 'function') return false
  if (el.closest('.twisty, .shell-icon')) return false
  return Boolean(el.closest('.cell-name, .cell-name-primary, .row-name-text, .tree-label, .row-name'))
}
