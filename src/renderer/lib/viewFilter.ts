/**
 * Global view filter: hides files/folders from listings and the tree.
 * Search results: clipped by the view filter only when Search “Show hidden” is off
 * (and the eye is on). With Show hidden on, every hit is shown.
 *
 * When enabled (browse / search without Show hidden):
 *   - items matching patterns are hidden
 *   - **folders** with the Windows Hidden attribute are hidden (Explorer “don’t show hidden”)
 *   - **files** with Hidden are still listed (ghosted) — a Hidden `.mp4` must not vanish
 *     while its `.srt` sibling stays visible
 *     except `.mfevirtual` documents (always shown in MFE; Hidden is for Explorer)
 * When disabled: everything shows; Windows-hidden items are greyed in the UI.
 *
 * Pattern language: see `src/shared/pathPatterns.ts`.
 */

import { compilePathPatterns, type PathPatternPredicate } from '@shared/pathPatterns'
import { isVirtualFolderDocumentPath } from '@shared/virtualFolder'

export type ViewFilterPredicate = PathPatternPredicate

export function compileViewFilter(patterns: string[], enabled: boolean): ViewFilterPredicate {
  if (!enabled || patterns.length === 0) return () => false
  return compilePathPatterns(patterns)
}

/** Cached compiled predicate — never recompile regexes per file (20k× was catastrophic). */
let cachedPatternsKey = '\0'
let cachedPredicate: ViewFilterPredicate = () => false

function predicateFor(patterns: string[]): ViewFilterPredicate {
  const key = patterns.join('\n')
  if (key === cachedPatternsKey) return cachedPredicate
  cachedPatternsKey = key
  cachedPredicate = compileViewFilter(patterns, true)
  return cachedPredicate
}

export type ViewFilterEntry = {
  path: string
  isHidden: boolean
  kind?: 'file' | 'dir' | 'symlink'
}

/**
 * True when the entry should be omitted from the view (patterns + Hidden folders).
 * Hidden **files** stay in the list (greyed). Hidden **folders** still omit when the eye is on.
 * `.mfevirtual` documents stay visible even when Hidden on disk.
 */
export function isExcludedByViewFilter(
  entry: ViewFilterEntry,
  patterns: string[],
  enabled: boolean,
  opts?: { ignoreHiddenAttr?: boolean }
): boolean {
  if (!enabled) return false
  const hideForHiddenAttr =
    !opts?.ignoreHiddenAttr &&
    entry.isHidden &&
    entry.kind !== 'file' &&
    !isVirtualFolderDocumentPath(entry.path)
  if (hideForHiddenAttr) return true
  if (patterns.length === 0) return false
  return predicateFor(patterns)(entry.path)
}

/** Visible row count — do not allocate a filtered copy of a 200k listing. */
export function countVisibleEntries(
  entries: readonly { path: string; isHidden: boolean }[],
  patterns: string[],
  enabled: boolean
): number {
  if (!enabled) return entries.length
  let n = 0
  for (const e of entries) {
    if (!isExcludedByViewFilter(e, patterns, enabled)) n++
  }
  return n
}

/** Select-all is a count compare — never walk items. */
export function listingHasAllSelected(selectedCount: number, listingCount: number): boolean {
  return listingCount > 0 && selectedCount === listingCount
}
