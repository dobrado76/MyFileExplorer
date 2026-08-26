/**
 * Helpers for adding paths to a repo-root `.gitignore`.
 */

/** Normalize a `.gitignore` line for equality checks (trim; keep trailing `/` meaning). */
export function normalizeGitignoreLine(line: string): string {
  return line.trim().replace(/\\/g, '/')
}

/**
 * Build the pattern to append for a repo-relative path.
 * Directories get a trailing `/`. Never returns empty / `.` / `..`.
 */
export function gitignorePatternForRelative(rel: string, isDirectory: boolean): string | null {
  let p = rel.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!p || p === '.' || p.includes('..')) return null
  if (p === '.git' || p.startsWith('.git/')) return null
  if (p === '.gitignore') return null
  if (isDirectory) p = `${p}/`
  return p
}

/** True if `pattern` is already covered by an existing exact line in `.gitignore` text. */
export function gitignoreAlreadyHas(content: string, pattern: string): boolean {
  const want = normalizeGitignoreLine(pattern)
  if (!want) return false
  const wantNoSlash = want.replace(/\/+$/, '')
  for (const raw of content.split(/\r?\n/)) {
    const line = normalizeGitignoreLine(raw)
    if (!line || line.startsWith('#')) continue
    if (line === want) return true
    // Treat `foo` and `foo/` as the same for dedupe of directories.
    if (line.replace(/\/+$/, '') === wantNoSlash) return true
  }
  return false
}

/** Append patterns to `.gitignore` body; ensure a trailing newline. */
export function appendGitignorePatterns(content: string, patterns: string[]): string {
  const toAdd = patterns.filter((p) => p && !gitignoreAlreadyHas(content, p))
  if (toAdd.length === 0) return content
  let next = content.replace(/\s+$/, '')
  if (next.length > 0) next += '\n'
  next += toAdd.join('\n')
  next += '\n'
  return next
}
