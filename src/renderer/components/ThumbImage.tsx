import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { api } from '../lib/ipc'
import { useAppStore } from '../store/appStore'
import { withThumbRequestSlot } from '../lib/thumbRequestQueue'
import {
  getThumbMemory,
  isThumbDecoded,
  markThumbDecoded,
  setThumbMemory,
  thumbMemoryKey,
  thumbPathKey,
  type ThumbMemoryEntry
} from '../lib/thumbMemory'

type Props = {
  path: string
  mtimeMs: number
  size: number
  fallback: JSX.Element
  /** Fired when a real content thumb is shown vs shell-icon fallback. */
  onHasContent?: (has: boolean) => void
  /** File-list scroller so IntersectionObserver matches the virtualized pane. */
  scrollRoot?: Element | null
}

function findScrollRoot(el: HTMLElement | null): Element | null {
  let p = el?.parentElement ?? null
  while (p) {
    const style = getComputedStyle(p)
    const oy = style.overflowY
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
      return p
    }
    p = p.parentElement
  }
  return null
}

function rectsOverlapWithMargin(
  r: DOMRectReadOnly,
  rootR: { top: number; left: number; bottom: number; right: number },
  margin: number
): boolean {
  return r.bottom >= rootR.top - margin && r.top <= rootR.bottom + margin
}

function preload(url: string): Promise<boolean> {
  if (isThumbDecoded(url)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      markThumbDecoded(url)
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
export function ThumbImage({
  path,
  mtimeMs,
  size,
  fallback,
  onHasContent,
  scrollRoot
}: Props): JSX.Element {
  const videoThumbRev = useAppStore((s) => s.videoThumbRev)
  const imageThumbRev = useAppStore((s) => s.thumbRevByPath[thumbPathKey(path)] ?? 0)
  const key = thumbMemoryKey(path, mtimeMs, size, videoThumbRev, imageThumbRev)
  const frameMs = useAppStore((s) => s.settings.vidThumbFrameMs)
  const opBusy = useAppStore((s) => s.fileOp != null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const [nearView, setNearView] = useState(false)
  const [entry, setEntry] = useState<ThumbMemoryEntry | null>(() => getThumbMemory(key) ?? null)
  const [displaySrc, setDisplaySrc] = useState<string | null>(() => {
    const hit = getThumbMemory(key)
    return hit?.url ?? null
  })
  const [failed, setFailed] = useState(false)
  const frameIdxRef = useRef(0)
  const reqIdRef = useRef(0)
  const prevKeyRef = useRef(key)
  const abortRef = useRef<AbortController | null>(null)
  const onHasContentRef = useRef(onHasContent)
  useLayoutEffect(() => {
    onHasContentRef.current = onHasContent
  })

  const showingContent = Boolean(displaySrc && !failed)

  // Sticky preview: only report true when we have a content thumb, and false
  // on definitive failure — never while loading / cold remount (avoids
  // has-preview ↔ icon-only layout thrash during scroll).
  useEffect(() => {
    if (showingContent) onHasContentRef.current?.(true)
    else if (failed) onHasContentRef.current?.(false)
  }, [showingContent, failed, path])

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const root = scrollRoot ?? findScrollRoot(el)
    const margin = 180
    const syncNear = (): boolean => {
      const r = el.getBoundingClientRect()
      if (!root) {
        return rectsOverlapWithMargin(
          r,
          {
            top: 0,
            left: 0,
            bottom: window.innerHeight,
            right: window.innerWidth
          },
          margin
        )
      }
      return rectsOverlapWithMargin(r, root.getBoundingClientRect(), margin)
    }
    setNearView((prev) => {
      const next = syncNear()
      return prev === next ? prev : next
    })
    const io = new IntersectionObserver(
      ([obs]) => {
        const next = Boolean(obs?.isIntersecting)
        setNearView((prev) => (prev === next ? prev : next))
      },
      {
        root,
        rootMargin: `${margin}px 0px`,
        threshold: 0
      }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [scrollRoot])

  // Abort the in-flight thumbs:get when this tile unmounts or the cache key
  // changes — not when IntersectionObserver says it left the near-view margin
  // while the virtualizer still holds the row (overscan). Dropping waiters on
  // nearView=false left the memory cache cold and caused shell-icon flicker
  // when scrolling back.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [key, path, size])

  // Resolve thumb URLs when near view (memory cache skips IPC).
  // After a cover write the cache key changes — refetch even if the
  // IntersectionObserver still says off-screen (busy overlay / virtualizer).
  useEffect(() => {
    const hit = getThumbMemory(key)
    if (hit) {
      prevKeyRef.current = key
      setEntry(hit)
      setFailed(false)
      setDisplaySrc(hit.url)
      return
    }
    const keyChanged = prevKeyRef.current !== key
    prevKeyRef.current = key
    if (!nearView && !keyChanged) return
    if (opBusy && !keyChanged) return
    // Still warming from a prior nearView pass — do not start a second slot.
    if (!keyChanged && abortRef.current && !abortRef.current.signal.aborted) return

    const ac = new AbortController()
    abortRef.current = ac
    const reqId = ++reqIdRef.current
    const cacheKey = key
    setFailed(false)
    void withThumbRequestSlot(() => api.thumbs.get({ path, size }), ac.signal).then((res) => {
      if (abortRef.current === ac) abortRef.current = null
      if (res === undefined) return
      if (res.ok && res.value.url) {
        const next: ThumbMemoryEntry = {
          url: res.value.url,
          frames: res.value.frames && res.value.frames.length > 1 ? res.value.frames : undefined
        }
        // Warm memory even if this tile went off-screen / remounted.
        setThumbMemory(cacheKey, next)
        if (reqId !== reqIdRef.current) return
        setEntry(next)
        setDisplaySrc(next.url)
      } else if (reqId === reqIdRef.current) {
        setFailed(true)
      }
    })
    // No abort / stale flag here: nearView flicker must not cancel a warming
    // request. Abort on key change / unmount is owned by the sibling effect;
    // a newer request bumps reqIdRef so late results are ignored.
  }, [key, path, size, nearView, opBusy])

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
      if (!isThumbDecoded(url)) {
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
