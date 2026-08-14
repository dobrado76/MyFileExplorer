import { joinPath, parentOf } from './paths'

function mediaUrlForPath(absPath: string): string {
  return `mfe-media://local/?p=${encodeURIComponent(absPath)}`
}

/** Rewrite Three.js loader URLs. Keep `mfe-media://…?p=` intact — stripping the query 403s. */
export function resolveModel3dMediaUrl(modelPath: string, ref: string): string | null {
  if (ref.startsWith('blob:') || ref.startsWith('data:')) return ref
  if (ref.startsWith('mfe-media:')) {
    try {
      const u = new URL(ref)
      if (u.searchParams.get('p')) return ref
      const leftover = decodeURIComponent(u.pathname.replace(/^\/+/, ''))
      if (leftover) return resolveModel3dMediaUrl(modelPath, leftover)
    } catch {
      return ref
    }
    return ref
  }
  const raw = ref.split('?')[0] ?? ref
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    return mediaUrlForPath(raw.replace(/\//g, '\\'))
  }
  const rel = raw.replace(/\//g, '\\').replace(/^\.\\/, '').replace(/^\\+/, '')
  if (!rel || rel.split('\\').includes('..')) return null
  const dir = parentOf(modelPath)
  if (!dir) return null
  return mediaUrlForPath(joinPath(dir, rel))
}
