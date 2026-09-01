import type { SearchResultItem } from './schemas/search'

/**
 * Lone `.` is an unfinished extension (`.obj`). As a substring it matches
 * almost every file — do not walk until there is more than the dot.
 */
export function isIncompleteSearchQuery(query: string): boolean {
  return query.trim() === '.'
}

/**
 * Whitespace-separated tokens. Bare `.ext` stays a substring so `.o` ⊃ `.ob` ⊃ `.obj`
 * (rewriting to `*.ext` would make `.o` miss `file.obj` and force a new walk).
 */
export function queryTokens(query: string): string[] {
  return query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

/** True when the token uses shell-style wildcards. */
export function tokenHasWildcards(token: string): boolean {
  return token.includes('*') || token.includes('?')
}

/** Convert a glob token to a case-insensitive RegExp matching the whole name. */
export function globToRegExp(token: string): RegExp {
  let src = '^'
  for (const ch of token) {
    if (ch === '*') src += '.*'
    else if (ch === '?') src += '.'
    else if (/[.+^${}()|[\]\\]/.test(ch)) src += `\\${ch}`
    else src += ch
  }
  src += '$'
  return new RegExp(src, 'i')
}

/**
 * Case-insensitive name match. Plain tokens = substring; `*` / `?` = shell glob.
 */
export function nameMatches(name: string, query: string): boolean {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return false
  const lower = name.toLowerCase()
  return tokens.every((t) => {
    if (tokenHasWildcards(t)) return globToRegExp(t).test(name)
    return lower.includes(t.toLowerCase())
  })
}

/** Plain toolbar name search — no Everything operators. */
export function isBasicNameQuery(raw: string): boolean {
  const t = raw.trim()
  if (!t) return false
  if (/[<|"]/.test(t)) return false
  if (/^[a-zA-Z]:[\\/]?/i.test(t)) return false
  if (
    /(?:^|\s)(!?)(size|ext|dm|dc|datemodified|datecreated|path|nopath|file|folder|pic|video|audio|doc|exe|zip|content|utf8content|note|hasnote|notestatus|todo|hasmeta|attrib|attributes|depth|parent|infolder|startwith|endwith|len|empty|count|dupe|sizedupe|namepartdupe|child|childcount|regex|case|nocase|ww|wholeword|noww):/i.test(
      t
    )
  ) {
    return false
  }
  // D70 dotted operators: meta.<key>:… / hasmeta.<key>:
  if (/(?:^|\s)!?(?:meta|hasmeta)\.[a-z][a-z0-9_]*:/i.test(t)) {
    return false
  }
  if (/\s![^\s]+/.test(t)) return false
  return true
}

/** `to` only adds characters onto `from` (`.o` → `.ob` → `.obj`). */
export function isSearchNarrowing(from: string, to: string): boolean {
  const a = from.trim()
  const b = to.trim()
  if (!a || a === '.' || !b || b === a) return false
  if (!isBasicNameQuery(a) || !isBasicNameQuery(b)) return false
  return b.startsWith(a)
}

/** Keep walk hits that still match a narrower name query. */
export function narrowSearchItems(
  items: SearchResultItem[],
  walkQuery: string,
  displayQuery: string
): SearchResultItem[] {
  const display = displayQuery.trim()
  if (!display || !isSearchNarrowing(walkQuery, display)) return items
  return items.filter((r) => nameMatches(r.name, display))
}
