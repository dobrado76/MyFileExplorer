/** Windows-aware path string helpers for the renderer (no Node access). */

const SEP_RE = /[\\/]+/

export function normalizeSlashes(p: string): string {
  const unc = p.startsWith('\\\\') || p.startsWith('//')
  const collapsed = p.replace(/\//g, '\\').replace(/\\{2,}/g, '\\')
  return unc ? '\\' + collapsed : collapsed
}

export function isUnc(p: string): boolean {
  return p.startsWith('\\\\')
}

/** "C:\" for drive paths, "\\server\share" for UNC share roots, "\\server" for hosts. */
export function rootOf(p: string): string | null {
  const n = normalizeSlashes(p)
  if (isUnc(n)) {
    const parts = n.slice(2).split(SEP_RE).filter(Boolean)
    if (parts.length >= 2) return `\\\\${parts[0]}\\${parts[1]}`
    if (parts.length === 1) return `\\\\${parts[0]}`
    return null
  }
  const m = /^([a-zA-Z]:)/.exec(n)
  return m ? `${m[1]}\\` : null
}

export function isRootPath(p: string): boolean {
  const n = stripTrailingSep(normalizeSlashes(p))
  if (isUnc(n)) {
    // Share root is the filesystem root for browsing; host is also a stop.
    const parts = n.slice(2).split(SEP_RE).filter(Boolean)
    return parts.length === 1
  }
  const root = rootOf(n)
  return root !== null && stripTrailingSep(root).toLowerCase() === n.toLowerCase()
}

export function stripTrailingSep(p: string): string {
  if (/^[a-zA-Z]:\\$/.test(p)) return p
  return p.replace(/[\\/]+$/, '')
}

export function basename(p: string): string {
  const n = stripTrailingSep(normalizeSlashes(p))
  if (/^[a-zA-Z]:\\?$/.test(n)) return n.slice(0, 2)
  if (isUnc(n)) {
    const parts = n.slice(2).split(SEP_RE).filter(Boolean)
    return parts[parts.length - 1] ?? n
  }
  const parts = n.split(SEP_RE).filter(Boolean)
  return parts[parts.length - 1] ?? n
}

export function parentOf(p: string): string | null {
  const n = stripTrailingSep(normalizeSlashes(p))
  if (isUnc(n)) {
    const parts = n.slice(2).split(SEP_RE).filter(Boolean)
    if (parts.length <= 1) return null
    if (parts.length === 2) return `\\\\${parts[0]}`
    return `\\\\${parts.slice(0, -1).join('\\')}`
  }
  if (isRootPath(n)) return null
  const idx = n.lastIndexOf('\\')
  if (idx < 0) return null
  const parent = n.slice(0, idx)
  if (/^[a-zA-Z]:$/.test(parent)) return parent + '\\'
  return parent
}

export function joinPath(dir: string, name: string): string {
  const d = normalizeSlashes(dir).replace(/\\+$/, '')
  return `${d}\\${name}`
}

export type Segment = { label: string; path: string }

export function segmentsOf(p: string): Segment[] {
  const n = stripTrailingSep(normalizeSlashes(p))
  const segments: Segment[] = []
  if (isUnc(n)) {
    const parts = n.slice(2).split(SEP_RE).filter(Boolean)
    if (parts.length === 0) return [{ label: n, path: n }]
    let acc = `\\\\${parts[0]}`
    segments.push({ label: parts[0]!, path: acc })
    for (let i = 1; i < parts.length; i++) {
      acc = `${acc}\\${parts[i]}`
      segments.push({ label: parts[i]!, path: acc })
    }
    return segments
  }
  const m = /^([a-zA-Z]:)\\?/.exec(n)
  if (!m) return [{ label: n, path: n }]
  const drive = `${m[1]}\\`
  segments.push({ label: m[1]!, path: drive })
  const rest = n.slice(m[0].length).split(SEP_RE).filter(Boolean)
  let acc = m[1]!
  for (const part of rest) {
    acc = `${acc}\\${part}`
    segments.push({ label: part, path: acc })
  }
  return segments
}

export function samePath(a: string, b: string): boolean {
  return (
    stripTrailingSep(normalizeSlashes(a)).toLowerCase() ===
    stripTrailingSep(normalizeSlashes(b)).toLowerCase()
  )
}

export function isUnderPath(child: string, parent: string): boolean {
  const c = stripTrailingSep(normalizeSlashes(child)).toLowerCase()
  const p = stripTrailingSep(normalizeSlashes(parent)).toLowerCase()
  return c === p || c.startsWith(p + '\\')
}

export function driveOf(p: string): string | null {
  const m = /^([a-zA-Z]):/.exec(normalizeSlashes(p))
  return m ? m[1]!.toLowerCase() : null
}

export function looksAbsolute(p: string): boolean {
  const n = normalizeSlashes(p.trim())
  return /^[a-zA-Z]:[\\/]/.test(n) || /^[a-zA-Z]:$/.test(n) || isUnc(n)
}
