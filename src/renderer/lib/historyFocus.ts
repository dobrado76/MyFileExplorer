import { samePath } from './paths'
import type { HistoryEntry } from '@shared/tabHistory'

/**
 * After Back/Forward, a late NAS listing must not steal keyboard focus.
 *
 * Anti-regression (Back → Arrow Down → F2): never force-setSelection to the
 * history focus row after `await loadListing`. Only scroll-to-focus when the
 * user is still on that row. See `historyFocusStillActive`.
 */

/** True when selection/focus are still exactly the history focus row. */
export function historyFocusStillActive(opts: {
  /** Folder we navigated to via history. */
  listingPath: string
  /** Tab cwd after the listing settled. */
  tabPath: string
  /** History entry focusPath (folder/file to highlight). */
  focusPath: string
  selected: string[]
  focusedPath: string | null
}): boolean {
  if (!samePath(opts.tabPath, opts.listingPath)) return false
  if (opts.selected.length !== 1) return false
  if (!samePath(opts.selected[0]!, opts.focusPath)) return false
  if (opts.focusedPath && !samePath(opts.focusedPath, opts.focusPath)) return false
  return true
}

/**
 * When older history entries lack focusPath, Explorer-style Back to a parent
 * focuses the child folder we just left.
 */
export function resolveBackFocusPath(
  prev: HistoryEntry,
  currentPath: string,
  parentOfCurrent: string | null
): string | undefined {
  if (prev.kind !== 'folder') return undefined
  if (prev.focusPath) return prev.focusPath
  if (parentOfCurrent && samePath(parentOfCurrent, prev.path)) return currentPath
  return undefined
}

/**
 * What a late history listing completion is allowed to do.
 * - `none`: user moved on — do not touch selection or scroll
 * - `scrollOnly`: still on history focus — may requestFileListScrollTo
 * - Never returns `reselect` — re-selecting after await is a known regression.
 */
export function historyLateListingAction(opts: {
  listingPath: string
  tabPath: string
  focusPath: string | undefined
  selected: string[]
  focusedPath: string | null
}): 'none' | 'scrollOnly' {
  if (!opts.focusPath) return 'none'
  if (
    !historyFocusStillActive({
      listingPath: opts.listingPath,
      tabPath: opts.tabPath,
      focusPath: opts.focusPath,
      selected: opts.selected,
      focusedPath: opts.focusedPath
    })
  ) {
    return 'none'
  }
  return 'scrollOnly'
}
