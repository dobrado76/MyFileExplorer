import { useEffect, useLayoutEffect, useState, type CSSProperties, type JSX } from 'react'
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
  /**
   * When this flips from true → false (rename dismissed without a listing
   * refresh), re-sync the glyph from the in-memory cache. A real rename
   * refreshes the listing and remounts rows; Escape / same-name commit does not.
   */
  renaming?: boolean
}

function extOf(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? ''
  const d = base.lastIndexOf('.')
  return d > 0 ? base.slice(d + 1).toLowerCase() : ''
}

function cachedUrl(key: string, extKey: string | null): string | null {
  const hit = memoryCache.get(key)
  if (hit !== undefined) return hit
  if (!extKey) return null
  return extMemoryCache.get(extKey) ?? null
}

/**
 * Native Windows shell icon for a path (SHGetFileInfo via main).
 * Falls back to a simple SVG while loading or if the shell icon fails.
 */
export function ShellIcon({ path, size, isDir, className, renaming }: Props): JSX.Element {
  const px = size <= 20 ? 16 : 32
  // Include kind in the key so a poisoned file glyph can't stick on a folder path.
  const key = `${path.toLowerCase()}|${px}|${isDir ? 'd' : 'f'}`
  const ext = isDir ? '' : extOf(path)
  const extKey =
    isDir !== true && ext && !PER_FILE_EXTS.has(ext) ? `${ext}|${px}` : null
  const [url, setUrl] = useState<string | null>(() => cachedUrl(key, extKey))
  const [failed, setFailed] = useState(false)

  const restoreFromCache = (): boolean => {
    const hit = cachedUrl(key, extKey)
    if (!hit) return false
    if (extKey && !memoryCache.get(key)) {
      memoryCache.set(key, hit)
    }
    setUrl(hit)
    setFailed(false)
    return true
  }

  // Cancel / same-name commit: no listing refresh — pull the glyph back from cache.
  useLayoutEffect(() => {
    if (renaming) return
    restoreFromCache()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when rename ends
  }, [renaming, key])

  useEffect(() => {
    let alive = true
    if (restoreFromCache()) return

    // Keep any existing glyph visible while a new fetch runs (do not flash blank).
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
        setFailed(false)
      } else if (!cachedUrl(key, extKey)) {
        setFailed(true)
      }
    }
    // Per-file shell icons (esp. .exe) are expensive — throttle IPC flood.
    void (perFile ? withIconRequestSlot(request) : request())
    return () => {
      alive = false
    }
    // restoreFromCache closes over key/extKey; deps cover those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, path, size, extKey, isDir, ext])

  const cls = `shell-icon${className ? ` ${className}` : ''}`
  const box: CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    display: 'block'
  }

  if (url && !failed) {
    return (
      <img
        className={cls}
        src={url}
        width={size}
        height={size}
        style={box}
        alt=""
        draggable={false}
        onError={() => {
          memoryCache.delete(key)
          if (extKey) extMemoryCache.delete(extKey)
          setUrl(null)
          setFailed(true)
        }}
      />
    )
  }

  const Placeholder = isDir ? FolderIcon : FileIcon
  return <Placeholder size={size} className={cls} style={box} />
}
