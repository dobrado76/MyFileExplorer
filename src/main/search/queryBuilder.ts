/** Pure helpers for building search SQL inputs. Testable without SQLite. */

export {
  globToRegExp,
  isBasicNameQuery,
  isIncompleteSearchQuery,
  nameMatches,
  queryTokens,
  tokenHasWildcards
} from '@shared/searchQuery'

import { queryTokens, tokenHasWildcards } from '@shared/searchQuery'

/**
 * Build an FTS5 MATCH expression from user input: each whitespace token is
 * quoted (neutralizing FTS operators) and given a prefix wildcard.
 * Returns null when there is nothing searchable.
 *
 * Note: FTS token prefix ≠ substring (e.g. `"photo"*` misses `MyPhoto.jpg`).
 * Prefer {@link buildNameLikeParams} for Explorer-like name search.
 */
export function buildFtsMatchExpression(query: string): string | null {
  const tokens = queryTokens(query).map((t) => t.replace(/"/g, '""'))
  if (tokens.length === 0) return null
  return tokens.map((t) => `"${t}"*`).join(' ')
}

/** Escape LIKE wildcards; use with `ESCAPE '\'`. */
export function escapeLike(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/** `%term%` contains-pattern with escaping. */
export function buildLikeContains(term: string): string {
  return `%${escapeLike(term.trim())}%`
}

/**
 * Convert a shell glob token (`*`, `?`) to a SQL LIKE pattern (`%`, `_`).
 * Literal `%` / `_` / `\` in the user token are escaped.
 */
export function globToLike(token: string): string {
  let out = ''
  for (const ch of token) {
    if (ch === '*') out += '%'
    else if (ch === '?') out += '_'
    else if (ch === '\\' || ch === '%' || ch === '_') out += `\\${ch}`
    else out += ch
  }
  return out
}

/**
 * One LIKE pattern per token — AND together in SQL so multi-word queries match
 * the same way as {@link nameMatches}.
 * - No wildcards → substring (`%term%`)
 * - With `*` / `?` → glob (`*.jpg` → `%.jpg`)
 */
export function buildNameLikeParams(query: string): string[] {
  return queryTokens(query).map((t) =>
    tokenHasWildcards(t) ? globToLike(t) : buildLikeContains(t)
  )
}

/** Prefix pattern matching everything under `dirPath` (inclusive of children). */
export function buildPathPrefixLike(dirPath: string): string {
  const withSep = dirPath.endsWith('\\') || dirPath.endsWith('/') ? dirPath : dirPath + '\\'
  return `${escapeLike(withSep)}%`
}

