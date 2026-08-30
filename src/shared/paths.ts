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

/** Drive / volume roots like `C:\` — not a deletable folder. */
export function isVolumeRootPath(p: string): boolean {
  const n = p.replace(/\//g, '\\').replace(/\\+$/, '')
  return /^[a-zA-Z]:$/i.test(n)
}

/** `C:\` and `C:` are the same volume root for compare / scope checks. */
function winPathKey(p: string): string {
  const n = stripTrailingSep(normalizeSlashes(p))
  if (/^[a-zA-Z]:\\$/.test(n)) return n.slice(0, 2).toLowerCase()
  return n.toLowerCase()
}

export function samePath(a: string, b: string): boolean {
  return winPathKey(a) === winPathKey(b)
}

/** True if child is parent or a descendant. */
export function isUnderPath(child: string, parent: string): boolean {
  const c = winPathKey(child)
  const p = winPathKey(parent)
  return c === p || c.startsWith(p + '\\')
}

export function pathKey(p: string): string {
  // Opaque Virtual Folder group rows are not filesystem paths — never run win
  // slash collapsing on them (encoded `%5C` / `|` must stay intact).
  if (typeof p === 'string' && p.startsWith('mfe-vfgroup:')) return p.toLowerCase()
  return winPathKey(p)
}

/** Longer path wins for specificity (by segment count / string length after normalize). */
export function pathSpecificity(p: string): number {
  return stripTrailingSep(normalizeSlashes(p)).length
}
