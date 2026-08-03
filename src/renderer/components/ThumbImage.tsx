import { useEffect, useRef, useState, type JSX } from 'react'
import { api } from '../lib/ipc'
import { useAppStore } from '../store/appStore'

type CacheEntry = { url: string; frames?: string[] }

const memoryCache = new Map<string, CacheEntry>()
const MAX_CACHE = 2000

/** Media URLs that have successfully decoded at least once this session. */
const decodedUrls = new Set<string>()

type Props = {
  path: string
  mtimeMs: number
  size: number
  fallback: JSX.Element
  /** Fired when a real content thumb is shown vs shell-icon fallback. */
  onHasContent?: (has: boolean) => void
}

function findScrollRoot(el: HTMLElement | null): Element | null {
  let p = el?.parentElement ?? null
  while (p) {
    const style = getComputedStyle(p)
    const oy = style.overflowY
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && p.scrollHeight > p.clientHeight) {
      return p
    }
    p = p.parentElement
  }
  return null
}

function preload(url: string): Promise<boolean> {
  if (decodedUrls.has(url)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      decodedUrls.add(url)
      resolve(true)
    }
    img.onerror = () => resolve(false)
    img.src = url
  })
}

/**
 * Lazily requests a thumbnail when near the scroll viewport; falls back to a type icon.
 * Video strips animate only while visible; next frame is shown only after decode.
 */
export function ThumbImage({ path, mtimeMs, size, fallback, onHasContent }: Props): JSX.Element {
  const videoThumbRev = useAppStore((s) => s.videoThumbRev)
  const key = `${path.toLowerCase()}|${mtimeMs}|${size}|${videoThumbRev}`
  const frameMs = useAppStore((s) => s.settings.vidThumbFrameMs)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const [nearView, setNearView] = useState(true)
  const [entry, setEntry] = useState<CacheEntry | null>(() => memoryCache.get(key) ?? null)
  const [displaySrc, setDisplaySrc] = useState<string | null>(() => {
    const hit = memoryCache.get(key)
    return hit?.url ?? null
  })
  const [failed, setFailed] = useState(false)
  const frameIdxRef = useRef(0)
  const reqIdRef = useRef(0)
  const onHasContentRef = useRef(onHasContent)
  onHasContentRef.current = onHasContent

  const showingContent = Boolean(displaySrc && !failed)

  useEffect(() => {
    onHasContentRef.current?.(showingContent)
  }, [showingContent, path])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const root = findScrollRoot(el)
    const io = new IntersectionObserver(
      ([obs]) => setNearView(Boolean(obs?.isIntersecting)),
      { root, rootMargin: '180px 0px', threshold: 0 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Resolve thumb URLs when near view (memory cache skips IPC).
  useEffect(() => {
    const hit = memoryCache.get(key)
    if (hit) {
      setEntry(hit)
      setFailed(false)
      setDisplaySrc(hit.url)
      return
    }
    if (!nearView) return

    const reqId = ++reqIdRef.current
    setFailed(false)
    void api.thumbs.get({ path, size }).then((res) => {
      if (reqId !== reqIdRef.current) return
      if (res.ok && res.value.url) {
        const next: CacheEntry = {
          url: res.value.url,
          frames: res.value.frames && res.value.frames.length > 1 ? res.value.frames : undefined
        }
        if (memoryCache.size > MAX_CACHE) {
          memoryCache.clear()
          decodedUrls.clear()
        }
        memoryCache.set(key, next)
        setEntry(next)
        setDisplaySrc(next.url)
      } else {
        setFailed(true)
      }
    })
  }, [key, path, size, nearView])

  // Animate strip frames while near view; keep current frame until the next is decoded.
  useEffect(() => {
    if (!nearView || !entry?.frames || entry.frames.length < 2) return
    const frames = entry.frames
    let cancelled = false
    frameIdxRef.current = 0

    void (async () => {
      for (let i = 0; i < frames.length; i++) {
        if (cancelled) return
        const url = frames[i]
        if (url) await preload(url)
      }
    })()

    const id = window.setInterval(() => {
      if (cancelled) return
      const next = (frameIdxRef.current + 1) % frames.length
      const url = frames[next]
      if (!url) return
      if (!decodedUrls.has(url)) {
        void preload(url)
        return
      }
      frameIdxRef.current = next
      setDisplaySrc(url)
    }, frameMs)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [nearView, entry, frameMs])

  return (
    <span ref={wrapRef} className="thumb-image">
      {displaySrc && !failed ? (
        <img src={displaySrc} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        fallback
      )}
    </span>
  )
}
