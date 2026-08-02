import { useEffect, useState, type JSX } from 'react'
import { api } from '../lib/ipc'

const memoryCache = new Map<string, string>()
const MAX_CACHE = 2000

type Props = {
  path: string
  mtimeMs: number
  size: number
  fallback: JSX.Element
}

/** Lazily requests a thumbnail; falls back to a type icon. */
export function ThumbImage({ path, mtimeMs, size, fallback }: Props): JSX.Element {
  const key = `${path.toLowerCase()}|${mtimeMs}|${size}`
  const [url, setUrl] = useState<string | null>(memoryCache.get(key) ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const cached = memoryCache.get(key)
    if (cached) {
      setUrl(cached)
      return
    }
    setUrl(null)
    setFailed(false)
    void api.thumbs.get({ path, size }).then((res) => {
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
    return <img src={url} alt="" draggable={false} onError={() => setFailed(true)} />
  }
  return fallback
}
