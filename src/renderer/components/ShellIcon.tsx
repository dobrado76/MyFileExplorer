import { useEffect, useState, type JSX } from 'react'
import { api } from '../lib/ipc'
import { FileIcon, FolderIcon } from '../lib/icons'

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
  const key = `${path.toLowerCase()}|${px}`
  const ext = isDir ? '' : extOf(path)
  const extKey = !isDir && ext && !PER_FILE_EXTS.has(ext) ? `${ext}|${px}` : null
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
    void api.icons.get({ path, size }).then((res) => {
      if (!alive) return
      if (res.ok && res.value.url) {
        if (memoryCache.size > MAX_CACHE) memoryCache.clear()
        memoryCache.set(key, res.value.url)
        if (extKey) extMemoryCache.set(extKey, res.value.url)
        setUrl(res.value.url)
      } else {
        setFailed(true)
      }
    })
    return () => {
      alive = false
    }
  }, [key, path, size, extKey])

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
