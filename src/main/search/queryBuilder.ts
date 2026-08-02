/** Pure helpers for building search SQL inputs. Testable without SQLite. */

/**
 * Build an FTS5 MATCH expression from user input: each whitespace token is
 * quoted (neutralizing FTS operators) and given a prefix wildcard.
 * Returns null when there is nothing searchable.
 */
export function buildFtsMatchExpression(query: string): string | null {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '""').trim())
    .filter((t) => t.length > 0)
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

/** Prefix pattern matching everything under `dirPath` (inclusive of children). */
export function buildPathPrefixLike(dirPath: string): string {
  const withSep = dirPath.endsWith('\\') || dirPath.endsWith('/') ? dirPath : dirPath + '\\'
  return `${escapeLike(withSep)}%`
}

/** Case-insensitive substring match used by the live walker. */
export function nameMatches(name: string, query: string): boolean {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
  if (tokens.length === 0) return false
  const lower = name.toLowerCase()
  return tokens.every((t) => lower.includes(t))
}
