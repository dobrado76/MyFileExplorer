/**
 * Search-exclude patterns must not hide an item the user explicitly named.
 * Example: exclude `!Thumbnails` still allows query `!Thumbnails` to find that folder.
 * Broad queries (`thumbs`, `photo`) still respect excludes (`Thumbs.db`, `*.js`).
 */
import path from 'node:path'
import type { PathPatternPredicate } from '@shared/pathPatterns'
import { globToRegExp, queryTokens, tokenHasWildcards } from '@shared/searchQuery'
import type { StructuredQuery, TextPred } from './everythingQuery'

function textPredNeedles(q: StructuredQuery): string[] {
  const out: string[] = []
  for (const group of q.textGroups) {
    for (const pred of group) {
      const n = needleFromPred(pred)
      if (n) out.push(n)
    }
  }
  return out
}

function needleFromPred(pred: TextPred): string | null {
  switch (pred.kind) {
    case 'substr':
    case 'exact':
    case 'startwith':
    case 'endwith':
    case 'glob':
      return pred.value
    case 'regex':
      return null
  }
}

/** True when a query needle is an intentional name for this basename (not a loose substring). */
export function basenameEscapesSearchExclude(
  fileName: string,
  query: string,
  q: StructuredQuery | null,
  basic: boolean
): boolean {
  const needles = basic ? queryTokens(query) : q ? textPredNeedles(q) : []
  const lower = fileName.toLowerCase()
  return needles.some((t) => {
    if (tokenHasWildcards(t) || (q && !basic && t.includes('*'))) {
      try {
        return globToRegExp(t).test(fileName)
      } catch {
        return false
      }
    }
    return lower === t.toLowerCase()
  })
}

/** True when excludes say skip, and the query did not explicitly name this basename. */
export function isSkippedBySearchExclude(
  absPath: string,
  excluded: PathPatternPredicate,
  query: string,
  q: StructuredQuery | null,
  basic: boolean
): boolean {
  if (!excluded(absPath)) return false
  const name = path.basename(absPath)
  if (basenameEscapesSearchExclude(name, query, q, basic)) return false
  return true
}
