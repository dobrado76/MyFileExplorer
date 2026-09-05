import { pathKey } from '@shared/paths'
import { isUnderPath, samePath } from './paths'

/**
 * After deleting items from a sorted view, pick the next path to select
 * (first survivor after the last removed item; else the previous survivor).
 * Matches Windows Explorer: next sibling, else previous, else none.
 */
export function nextSelectionAfterDelete(orderedPaths: string[], removed: string[]): string | null {
  if (orderedPaths.length === 0 || removed.length === 0) return null
  const gone = new Set(removed.map((p) => pathKey(p)))
  let lastRemovedIdx = -1
  for (let i = 0; i < orderedPaths.length; i++) {
    if (gone.has(pathKey(orderedPaths[i]!))) lastRemovedIdx = i
  }
  if (lastRemovedIdx < 0) return null
  for (let i = lastRemovedIdx + 1; i < orderedPaths.length; i++) {
    const p = orderedPaths[i]!
    if (!gone.has(pathKey(p))) return p
  }
  for (let i = lastRemovedIdx - 1; i >= 0; i--) {
    const p = orderedPaths[i]!
    if (!gone.has(pathKey(p))) return p
  }
  return null
}

function pathRemovedOrUnder(path: string, removed: string[]): boolean {
  return removed.some((r) => samePath(path, r) || isUnderPath(path, r))
}

/** True when the user changed selection while a slow trash/delete was in flight. */
export function selectionChangedDuringLazyDelete(
  currentSelection: string[],
  expectedSelection: string[]
): boolean {
  return (
    currentSelection.length !== expectedSelection.length ||
    currentSelection.some(
      (path, index) => !expectedSelection[index] || !samePath(path, expectedSelection[index]!)
    )
  )
}

export type LazyDeleteSelectionResult = {
  selected: string[]
  selectionAnchor: string | null
  focusedPath: string | null
}

/**
 * After a lazy delete/trash finishes: keep the user's newer selection if they
 * moved during the op; otherwise keep the pre-op survivor focus when still listed.
 * Anti-regression: d8f2741 — never force expectedSelection over a live change.
 */
export function resolveSelectionAfterLazyDelete(opts: {
  currentSelection: string[]
  expectedSelection: string[] | undefined
  removed: string[]
  /** Paths still present in the listing (post-prune). */
  listingPaths: readonly string[]
  selectionAnchor: string | null
  focusedPath: string | null
}): LazyDeleteSelectionResult {
  const listingHas = (p: string): boolean => opts.listingPaths.some((e) => samePath(e, p))

  if (opts.expectedSelection !== undefined) {
    if (selectionChangedDuringLazyDelete(opts.currentSelection, opts.expectedSelection)) {
      const stillSelected = opts.currentSelection.filter(
        (path) => !pathRemovedOrUnder(path, opts.removed)
      )
      const anchor =
        opts.selectionAnchor && stillSelected.some((path) => samePath(path, opts.selectionAnchor!))
          ? opts.selectionAnchor
          : (stillSelected[0] ?? null)
      const focused =
        opts.focusedPath && stillSelected.some((path) => samePath(path, opts.focusedPath!))
          ? opts.focusedPath
          : (stillSelected[stillSelected.length - 1] ?? null)
      return { selected: stillSelected, selectionAnchor: anchor, focusedPath: focused }
    }
    const focused = opts.focusedPath && listingHas(opts.focusedPath) ? opts.focusedPath : null
    if (focused) {
      return { selected: [focused], selectionAnchor: focused, focusedPath: focused }
    }
    return { selected: [], selectionAnchor: null, focusedPath: null }
  }

  const stillSelected = opts.currentSelection.filter(
    (path) => !pathRemovedOrUnder(path, opts.removed) && listingHas(path)
  )
  if (stillSelected.length > 0) {
    const focus = stillSelected[stillSelected.length - 1]!
    return {
      selected: stillSelected,
      selectionAnchor: stillSelected[0]!,
      focusedPath: focus
    }
  }
  return { selected: [], selectionAnchor: null, focusedPath: null }
}
