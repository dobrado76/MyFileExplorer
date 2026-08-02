/** Platform-agnostic Windows path helpers (no Node). */

export function normalizeSlashes(p: string): string {
  const unc = p.startsWith('\\\\') || p.startsWith('//')
  const collapsed = p.replace(/\//g, '\\').replace(/\\{2,}/g, '\\')
  return unc ? '\\' + collapsed : collapsed
}

export function stripTrailingSep(p: string): string {
  if (/^[a-zA-Z]:\\$/.test(p)) return p
  return p.replace(/[\\/]+$/, '')
}

export function samePath(a: string, b: string): boolean {
  return (
    stripTrailingSep(normalizeSlashes(a)).toLowerCase() ===
    stripTrailingSep(normalizeSlashes(b)).toLowerCase()
  )
}

/** True if child is parent or a descendant. */
export function isUnderPath(child: string, parent: string): boolean {
  const c = stripTrailingSep(normalizeSlashes(child)).toLowerCase()
  const p = stripTrailingSep(normalizeSlashes(parent)).toLowerCase()
  return c === p || c.startsWith(p + '\\')
}

export function pathKey(p: string): string {
  return stripTrailingSep(normalizeSlashes(p)).toLowerCase()
}

/** Longer path wins for specificity (by segment count / string length after normalize). */
export function pathSpecificity(p: string): number {
  return stripTrailingSep(normalizeSlashes(p)).length
}
