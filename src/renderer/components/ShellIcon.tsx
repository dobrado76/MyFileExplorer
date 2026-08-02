import { useEffect, useState, type JSX } from 'react'
import { api } from '../lib/ipc'
import { FileIcon, FolderIcon } from '../lib/icons'

const memoryCache = new Map<string, string>()
const MAX_CACHE = 4000

type Props = {
  path: string
  /** Display size in CSS pixels (16 for list/tree, 32+ for grid). */
  size: number
  /** Hint for generic placeholder while loading. */
  isDir?: boolean
  className?: string
}

/**
 * Native Windows shell icon for a path (SHGetFileInfo via main).
 * Falls back to a simple SVG while loading or if the shell icon fails.
 */
export function ShellIcon({ path, size, isDir, className }: Props): JSX.Element {
  const key = `${path.toLowerCase()}|${size <= 20 ? 16 : 32}`
  const [url, setUrl] = useState<string | null>(() => memoryCache.get(key) ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const cached = memoryCache.get(key)
    if (cached) {
      setUrl(cached)
      setFailed(false)
      return
    }
    setUrl(null)
    setFailed(false)
    void api.icons.get({ path, size }).then((res) => {
      if (!alive) return
      if (res.ok && res.value.url) {
        if (memoryCache.size > MAX_CACHE) memoryCache.clear()
        memoryCache.set(key, res.value.url)
        setUrl(res.value.url)
      } else {
        setFailed(true)
      }
    })
    return () => {
      alive = false
    }
  }, [key, path, size])

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
