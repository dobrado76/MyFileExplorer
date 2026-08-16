/**
 * Global view filter: hides files/folders from listings, the tree and search
 * results. Purely visual — never touches filesystem attributes.
 *
 * When enabled:
 *   - items matching patterns are hidden
 *   - items with the Windows Hidden attribute are hidden (Explorer “don’t show hidden”)
 * When disabled: everything shows; Windows-hidden items are greyed in the UI.
 *
 * Pattern language: see `src/shared/pathPatterns.ts`.
 */

import { compilePathPatterns, type PathPatternPredicate } from '@shared/pathPatterns'

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

/** True when the entry should be omitted from the view (patterns + Windows Hidden). */
export function isExcludedByViewFilter(
  entry: { path: string; isHidden: boolean },
  patterns: string[],
  enabled: boolean
): boolean {
  if (!enabled) return false
  if (entry.isHidden) return true
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
