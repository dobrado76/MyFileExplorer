/**
 * Path glob patterns shared by the view filter and search-index excludes.
 *
 * Case-insensitive; `/` and `\` interchangeable:
 *   *\name        anything named "name" anywhere
 *   *\*.tmp       by extension (name ending in .tmp)
 *   .tmp          same as *\*.tmp
 *   *.log         same idea (already wildcard-anchored)
 *   *\cache*      wildcards in the name (`*` any chars, `?` one char)
 *   *foo*         substring anywhere in the path
 *   D:\a\b        this exact path (and everything under it)
 *   name          bare names are treated as *\name
 *   # comment     ignored
 *
 * A match also includes all descendants.
 */

export type PathPatternPredicate = (absPath: string) => boolean

const REGEX_SPECIALS = /[.+^${}()|[\]\\]/g

export function normalizePathPattern(raw: string): string | null {
  let p = raw.trim()
  if (!p || p.startsWith('#')) return null
  p = p.replace(/\//g, '\\')
  const unc = p.startsWith('\\\\')
  p = p.replace(/\\{2,}/g, '\\')
  if (unc) p = '\\' + p
  if (!/^[a-zA-Z]:\\$/.test(p)) p = p.replace(/\\+$/, '')
  if (!p) return null

  // ".tmp" / ".tar.gz" → any name ending with that suffix.
  if (/^\.[^\\/:*?"<>|\s]+$/.test(p)) {
    return `*\\*${p}`
  }

  const anchored = /^[a-zA-Z]:/.test(p) || p.startsWith('\\\\') || p.startsWith('*')
  if (!anchored) p = '*\\' + p
  return p
}

function patternToRegex(pattern: string): RegExp {
  let src = ''
  for (const ch of pattern) {
    if (ch === '*') src += '[^]*'
    else if (ch === '?') src += '[^\\\\]'
    else src += ch.replace(REGEX_SPECIALS, '\\$&')
  }
  return new RegExp(`^${src}(?:$|\\\\)`, 'i')
}

/** True when `absPath` matches any pattern (or is under a matching folder). */
export function compilePathPatterns(patterns: readonly string[]): PathPatternPredicate {
  if (patterns.length === 0) return () => false
  const regexes: RegExp[] = []
  for (const raw of patterns) {
    const p = normalizePathPattern(raw)
    if (!p) continue
    try {
      regexes.push(patternToRegex(p))
    } catch {
      /* skip unusable pattern */
    }
  }
  if (regexes.length === 0) return () => false
  return (absPath: string) => {
    const n = absPath.replace(/\//g, '\\')
    return regexes.some((r) => r.test(n))
  }
}
