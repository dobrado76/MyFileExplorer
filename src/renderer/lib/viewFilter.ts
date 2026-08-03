/**
 * Global view filter: hides files/folders from listings, the tree and search
 * results. Purely visual — never touches filesystem attributes.
 *
 * When enabled:
 *   - items matching patterns are hidden
 *   - items with the Windows Hidden attribute are hidden (Explorer “don’t show hidden”)
 * When disabled: everything shows; Windows-hidden items are greyed in the UI.
 *
 * Pattern forms (case-insensitive, `/` and `\` interchangeable):
 *   *\name        hide anything named "name" anywhere
 *   *\*.tmp       hide by extension (any name ending in .tmp)
 *   .tmp          same as *\*.tmp (extension shorthand)
 *   *\cache*      wildcards in the name (`*` any chars, `?` one char)
 *   *foo*         substring match anywhere in the path
 *   D:\a\b        hide this exact path (and everything under it)
 *   name          bare names are treated as *\name
 *   # comment     lines starting with # are ignored
 *
 * `*` matches any characters (including `\`), `?` matches a single
 * character within a name. A match also hides all descendants.
 */

export type ViewFilterPredicate = (absPath: string) => boolean

const REGEX_SPECIALS = /[.+^${}()|[\]\\]/g

function normalizePattern(raw: string): string | null {
  let p = raw.trim()
  if (!p || p.startsWith('#')) return null
  p = p.replace(/\//g, '\\')
  const unc = p.startsWith('\\\\')
  p = p.replace(/\\{2,}/g, '\\')
  if (unc) p = '\\' + p
  // Strip trailing separators (except a bare drive root like "D:\")
  if (!/^[a-zA-Z]:\\$/.test(p)) p = p.replace(/\\+$/, '')
  if (!p) return null

  // ".tmp" / ".tar.gz" → hide any file/folder whose name ends with that suffix.
  if (/^\.[^\\/:*?"<>|\s]+$/.test(p)) {
    return `*\\*${p}`
  }

  // Anything not anchored to a drive, UNC root or wildcard applies everywhere.
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
  // Match the whole path, or a prefix ending at a separator (hides descendants).
  return new RegExp(`^${src}(?:$|\\\\)`, 'i')
}

export function compileViewFilter(patterns: string[], enabled: boolean): ViewFilterPredicate {
  if (!enabled || patterns.length === 0) return () => false
  const regexes: RegExp[] = []
  for (const raw of patterns) {
    const p = normalizePattern(raw)
    if (!p) continue
    try {
      regexes.push(patternToRegex(p))
    } catch {
      // unusable pattern — skip rather than break the whole filter
    }
  }
  if (regexes.length === 0) return () => false
  return (absPath: string) => {
    const n = absPath.replace(/\//g, '\\')
    return regexes.some((r) => r.test(n))
  }
}

/** True when the entry should be omitted from the view (patterns + Windows Hidden). */
export function isExcludedByViewFilter(
  entry: { path: string; isHidden: boolean },
  patterns: string[],
  enabled: boolean
): boolean {
  if (!enabled) return false
  if (entry.isHidden) return true
  return compileViewFilter(patterns, true)(entry.path)
}
