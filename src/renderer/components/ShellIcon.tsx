import { useEffect, useState, type JSX } from 'react'
import { api } from '../lib/ipc'
import { FileIcon, FolderIcon } from '../lib/icons'
import { withIconRequestSlot } from '../lib/iconRequestQueue'

const memoryCache = new Map<string, string>()
/** Same glyph for every file of an extension (matches main's extUrlCache). */
const extMemoryCache = new Map<string, string>()
const MAX_CACHE = 4000
/** Icons that are per-file on Windows (must not share by extension). */
const PER_FILE_EXTS = new Set([
  'exe',
  'lnk',
  'ico',
  'dll',
  'scr',
  'cpl',
  'msi',
  'appx',
  'msix',
  'msc'
])

type Props = {
  path: string
  /** Display size in CSS pixels (16 for list/tree, 32+ for grid). */
  size: number
  /** Hint for generic placeholder while loading. */
  isDir?: boolean
  className?: string
}

function extOf(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? ''
  const d = base.lastIndexOf('.')
  return d > 0 ? base.slice(d + 1).toLowerCase() : ''
}

/**
 * Native Windows shell icon for a path (SHGetFileInfo via main).
 * Falls back to a simple SVG while loading or if the shell icon fails.
 */
export function ShellIcon({ path, size, isDir, className }: Props): JSX.Element {
  const px = size <= 20 ? 16 : 32
  // Include kind in the key so a poisoned file glyph can't stick on a folder path.
  const key = `${path.toLowerCase()}|${px}|${isDir ? 'd' : 'f'}`
  const ext = isDir ? '' : extOf(path)
  const extKey =
    isDir !== true && ext && !PER_FILE_EXTS.has(ext) ? `${ext}|${px}` : null
  const [url, setUrl] = useState<string | null>(
    () => memoryCache.get(key) ?? (extKey ? extMemoryCache.get(extKey) ?? null : null)
  )
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const pathHit = memoryCache.get(key)
    if (pathHit) {
      setUrl(pathHit)
      setFailed(false)
      return
    }
    if (extKey) {
      const extHit = extMemoryCache.get(extKey)
      if (extHit) {
        memoryCache.set(key, extHit)
        setUrl(extHit)
        setFailed(false)
        return
      }
    }
    setUrl(null)
    setFailed(false)
    const perFile = isDir === true || PER_FILE_EXTS.has(ext)
    const request = async (): Promise<void> => {
      if (!alive) return
      const res = await api.icons.get({ path, size, isDir: isDir === true })
      if (!alive) return
      if (res.ok && res.value.url) {
        if (memoryCache.size > MAX_CACHE) memoryCache.clear()
        memoryCache.set(key, res.value.url)
        // Never put folder icons into the shared extension cache.
        if (extKey && isDir !== true) extMemoryCache.set(extKey, res.value.url)
        setUrl(res.value.url)
      } else {
        setFailed(true)
      }
    }
    // Per-file shell icons (esp. .exe) are expensive — throttle IPC flood.
    void (perFile ? withIconRequestSlot(request) : request())
    return () => {
      alive = false
    }
  }, [key, path, size, extKey, isDir, ext])

  if (url && !failed) {
    return (
      <img
        className={`shell-icon${className ? ` ${className}` : ''}`}
        src={url}
        width={size}
        height={size}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
      />
    )
  }

  const Placeholder = isDir ? FolderIcon : FileIcon
  return <Placeholder size={size} className={className} />
}
