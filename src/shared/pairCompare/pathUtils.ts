/** Normalize a relative path for pairing keys (never mutates the display name). */
export function normalizeRelativePath(
  rel: string,
  caseSensitive: boolean
): string {
  let p = rel.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/')
  if (p.endsWith('/') && p.length > 1) p = p.slice(0, -1)
  if (p === '.' || p === '/') return ''
  return caseSensitive ? p : p.toLowerCase()
}

export function relativeDepth(rel: string): number {
  const n = rel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!n) return 0
  return n.split('/').filter(Boolean).length - 1
}

export function parentRelativePath(rel: string): string | null {
  const n = rel.replace(/\\/g, '/').replace(/\/+$/g, '')
  const i = n.lastIndexOf('/')
  if (i <= 0) return i === 0 ? null : n.includes('/') ? n.slice(0, i) : null
  return n.slice(0, i)
}

export function joinUnderRoot(root: string, relativePath: string): string {
  const r = root.replace(/[/\\]+$/, '')
  const rel = relativePath.replace(/^[/\\]+/, '').replace(/\//g, '\\')
  if (!rel) return r
  return `${r}\\${rel}`
}

/** True when `inner` is the same as or under `outer` (Windows-insensitive by default). */
export function isPathUnder(outer: string, inner: string, caseSensitive = false): boolean {
  const a = outer.replace(/[/\\]+$/, '').replace(/\//g, '\\')
  const b = inner.replace(/[/\\]+$/, '').replace(/\//g, '\\')
  const ak = caseSensitive ? a : a.toLowerCase()
  const bk = caseSensitive ? b : b.toLowerCase()
  if (ak === bk) return true
  const prefix = ak.endsWith('\\') ? ak : ak + '\\'
  return bk.startsWith(prefix)
}

export function emptyCounts(): Record<
  | 'identical'
  | 'left_only'
  | 'right_only'
  | 'left_newer'
  | 'right_newer'
  | 'different'
  | 'type_conflict'
  | 'metadata_only'
  | 'inaccessible'
  | 'error',
  number
> {
  return {
    identical: 0,
    left_only: 0,
    right_only: 0,
    left_newer: 0,
    right_newer: 0,
    different: 0,
    type_conflict: 0,
    metadata_only: 0,
    inaccessible: 0,
    error: 0
  }
}
