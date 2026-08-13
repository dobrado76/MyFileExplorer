/** Windows-aware path string helpers for the renderer (no Node access). */

import {
  formatRemoteLocation,
  isRemoteLocation,
  parseRemoteLocation,
  remoteBasename,
  remoteJoin,
  remoteParentPath
} from '@shared/remotePaths'

const SEP_RE = /[\\/]+/

export function normalizeSlashes(p: string): string {
  // Preserve single-leading POSIX absolute paths (start with '/'), but treat
  // double-leading '//' as UNC (Windows network) like the previous impl.
  if (p.startsWith('//')) {
    // fall through to UNC handling below
  } else if (p.startsWith('/')) {
    return p.replace(/\/{2,}/g, '/')
  }
  const unc = p.startsWith('\\') || p.startsWith('//')
  const collapsed = p.replace(/\//g, '\\').replace(/\\{2,}/g, '\\')
  return unc ? '\\' + collapsed : collapsed
}

export function isUnc(p: string): boolean {
  return p.startsWith('\\')
}

/** "C:\\" for drive paths, "\\\\server\\share" for UNC share roots, "\\\\server" for hosts. */
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
  // POSIX root
  if (n.startsWith('/')) return stripTrailingSep(n) === '/'
  const root = rootOf(n)
  return root !== null && stripTrailingSep(root).toLowerCase() === n.toLowerCase()
}

export function stripTrailingSep(p: string): string {
  if (/^[a-zA-Z]:\\$/.test(p)) return p
  return p.replace(/[\\/]+$/, '')
}

export function basename(p: string): string {
  if (isRemoteLocation(p)) {
    const loc = parseRemoteLocation(p)
    if (!loc) return p
    return remoteBasename(loc.remotePath) || loc.connectionId
  }
  const n = stripTrailingSep(normalizeSlashes(p))
  if (n.startsWith('/')) {
    if (n === '/') return '/'
    const parts = n.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? n
  }
  if (/^[a-zA-Z]:\\?$/.test(n)) return n.slice(0, 2)
  if (isUnc(n)) {
    const parts = n.slice(2).split(SEP_RE).filter(Boolean)
    return parts[parts.length - 1] ?? n
  }
  const parts = n.split(SEP_RE).filter(Boolean)
  return parts[parts.length - 1] ?? n
}

export function parentOf(p: string): string | null {
  if (isRemoteLocation(p)) {
    const loc = parseRemoteLocation(p)
    if (!loc) return null
    const parent = remoteParentPath(loc.remotePath)
    if (parent == null) return null
    return formatRemoteLocation(loc.connectionId, parent)
  }
  const n = stripTrailingSep(normalizeSlashes(p))
  if (n.startsWith('/')) {
    if (n === '/') return null
    const idx = n.lastIndexOf('/')
    if (idx < 0) return null
    const parent = n.slice(0, idx) || '/'
    return parent
  }
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
  if (isRemoteLocation(dir)) {
    const loc = parseRemoteLocation(dir)
    if (!loc) return dir
    const joined = remoteJoin(loc.remotePath, name)
    if (!joined) return dir
    return formatRemoteLocation(loc.connectionId, joined)
  }
  const d = normalizeSlashes(dir).replace(/\\+$/, '')
  return `${d}\\${name}`
}

export type Segment = { label: string; path: string }

export function segmentsOf(p: string): Segment[] {
  if (isRemoteLocation(p)) {
    const loc = parseRemoteLocation(p)
    if (!loc) return [{ label: p, path: p }]
    const segments: Segment[] = [
      { label: 'Remote', path: formatRemoteLocation(loc.connectionId, '/') }
    ]
    if (loc.remotePath === '/') return segments
    const parts = loc.remotePath.split('/').filter(Boolean)
    let acc = ''
    for (const part of parts) {
      acc += '/' + part
      segments.push({
        label: part,
        path: formatRemoteLocation(loc.connectionId, acc)
      })
    }
    return segments
  }
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
  // POSIX absolute path
  if (n.startsWith('/')) {
    segments.push({ label: '/', path: '/' })
    if (n === '/') return segments
    const parts = n.split('/').filter(Boolean)
    let acc = '/'
    for (const part of parts) {
      acc = acc === '/' ? `/${part}` : `${acc}/${part}`
      segments.push({ label: part, path: acc })
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
  if (isRemoteLocation(a) || isRemoteLocation(b)) {
    const la = parseRemoteLocation(a)
    const lb = parseRemoteLocation(b)
    if (!la || !lb) return false
    return la.connectionId === lb.connectionId && la.remotePath === lb.remotePath
  }
  const na = stripTrailingSep(normalizeSlashes(a))
  const nb = stripTrailingSep(normalizeSlashes(b))
  // POSIX: case-sensitive
  if (na.startsWith('/') || nb.startsWith('/')) return na === nb
  return na.toLowerCase() === nb.toLowerCase()
}

export function isUnderPath(child: string, parent: string): boolean {
  if (isRemoteLocation(child) || isRemoteLocation(parent)) {
    const c = parseRemoteLocation(child)
    const p = parseRemoteLocation(parent)
    if (!c || !p || c.connectionId !== p.connectionId) return false
    if (p.remotePath === '/') return true
    return c.remotePath === p.remotePath || c.remotePath.startsWith(p.remotePath + '/')
  }
  const ca = stripTrailingSep(normalizeSlashes(child))
  const pa = stripTrailingSep(normalizeSlashes(parent))
  // POSIX paths: case-sensitive, use '/'
  if (ca.startsWith('/') && pa.startsWith('/')) {
    return ca === pa || ca.startsWith(pa + '/')
  }
  const c = ca.toLowerCase()
  const p = pa.toLowerCase()
  return c === p || c.startsWith(p + '\\')
}

export function driveOf(p: string): string | null {
  const m = /^([a-zA-Z]):/.exec(normalizeSlashes(p))
  return m ? m[1]!.toLowerCase() : null
}

export function looksAbsolute(p: string): boolean {
  if (isRemoteLocation(p.trim())) return parseRemoteLocation(p.trim()) != null
  const n = normalizeSlashes(p.trim())
  // Accept Windows drive, UNC, and POSIX '/'-leading absolute paths.
  return (
    /^[a-zA-Z]:[\\/]/.test(n) ||
    /^[a-zA-Z]:$/.test(n) ||
    isUnc(n) ||
    n.startsWith('/')
  )
}
