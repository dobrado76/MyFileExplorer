/** Opaque remote location scheme used in tab paths and IPC. */
export const REMOTE_URI_SCHEME = 'mfe-remote:'

const REMOTE_RE = /^mfe-remote:\/\/([^/]+)(\/.*)?$/i

export type RemoteLocation = {
  connectionId: string
  /** Absolute POSIX path on the remote (`/` or `/foo/bar`). */
  remotePath: string
}

export function isRemoteLocation(path: string): boolean {
  return typeof path === 'string' && path.trim().toLowerCase().startsWith('mfe-remote://')
}

export function parseRemoteLocation(input: string): RemoteLocation | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  const m = REMOTE_RE.exec(trimmed)
  if (!m) return null
  const connectionId = decodeURIComponent(m[1] ?? '').trim()
  if (!connectionId) return null
  const rawPath = m[2] && m[2].length > 0 ? m[2] : '/'
  const remotePath = normalizeRemotePosixPath(rawPath)
  if (!remotePath) return null
  return { connectionId, remotePath }
}

/** Collapse `.` / `..`, force leading `/`, reject escape above root. */
export function normalizeRemotePosixPath(input: string): string | null {
  if (typeof input !== 'string' || input.trim().length === 0) return null
  let p = input.trim().replace(/\\/g, '/')
  if (!p.startsWith('/')) p = '/' + p
  const parts = p.split('/').filter((s) => s.length > 0)
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    if (part.includes('\0')) return null
    stack.push(part)
  }
  return stack.length === 0 ? '/' : '/' + stack.join('/')
}

export function formatRemoteLocation(connectionId: string, remotePath: string): string {
  const id = encodeURIComponent(connectionId)
  const norm = normalizeRemotePosixPath(remotePath) ?? '/'
  if (norm === '/') return `mfe-remote://${id}/`
  return `mfe-remote://${id}${norm}`
}

export function remoteParentPath(remotePath: string): string | null {
  const norm = normalizeRemotePosixPath(remotePath)
  if (!norm || norm === '/') return null
  const idx = norm.lastIndexOf('/')
  if (idx <= 0) return '/'
  return norm.slice(0, idx) || '/'
}

export function remoteBasename(remotePath: string): string {
  const norm = normalizeRemotePosixPath(remotePath) ?? '/'
  if (norm === '/') return ''
  const idx = norm.lastIndexOf('/')
  return idx >= 0 ? norm.slice(idx + 1) : norm
}

export function remoteJoin(parent: string, name: string): string | null {
  const base = normalizeRemotePosixPath(parent)
  if (!base) return null
  const n = name.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!n || n.includes('/') || n === '.' || n === '..') return null
  if (base === '/') return normalizeRemotePosixPath('/' + n)
  return normalizeRemotePosixPath(base + '/' + n)
}
