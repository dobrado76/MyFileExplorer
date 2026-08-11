import { useEffect, useRef, useState, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { basename } from '../lib/paths'
import { isEditableImagePath } from '@shared/imageEdit'
import {
  isEditImageSlideshowKey,
  isNumpadCode,
  isPipeUndoKey,
  isStopSlideshowKey,
  codeToKeyToken,
  normalizeKeyToken,
  type SlideshowKeyLike
} from '@shared/slideshow/keys'
import { SpinnerIcon } from '../lib/icons'
import { slideshowCurrentPath, slideshowLength } from '../lib/slideshowTypes'
import { useIdleCursorHide } from '../lib/useIdleCursorHide'

type Buf = { url: string; path: string; rev: number }

/**
 * Fullscreen slideshow / categorizer (gate-on only).
 * Always double-buffers images and swaps on requestAnimationFrame (V-Sync)
 * so there is no black flash or mid-refresh tearing between frames.
 */
export function SlideshowOverlay(): JSX.Element | null {
  const enabled = useAppStore((s) => s.settings.slideshowFeaturesEnabled)
  const active = useAppStore((s) => s.slideshow.active)
  const map = useAppStore((s) => s.slideshow.categorizerMap)
  const imageRevision = useAppStore((s) => s.slideshow.imageRevision)
  const drawCaption = useAppStore((s) => s.settings.slideshow.drawCaption)
  const delayMs = useAppStore((s) => s.settings.slideshow.delayMs)
  const stopSlideshow = useAppStore((s) => s.stopSlideshow)
  const slideshowInterrupt = useAppStore((s) => s.slideshowInterrupt)
  const slideshowNavigate = useAppStore((s) => s.slideshowNavigate)
  const slideshowMapAction = useAppStore((s) => s.slideshowMapAction)
  const slideshowUndoAction = useAppStore((s) => s.slideshowUndoAction)
  const slideshowAdvanceAuto = useAppStore((s) => s.slideshowAdvanceAuto)
  const slideshowSkipUnloadable = useAppStore((s) => s.slideshowSkipUnloadable)
  const openImageEditor = useAppStore((s) => s.openImageEditor)
  const openContextMenu = useAppStore((s) => s.openContextMenu)
  const notify = useAppStore((s) => s.notify)
  const dialogOpen = useAppStore((s) => s.dialog !== null)
  const imageEditorOpen = useAppStore((s) => s.imageEditor !== null)
  const contextMenuOpen = useAppStore((s) => s.contextMenu !== null)

  const [bufs, setBufs] = useState<[Buf | null, Buf | null]>([null, null])
  const [front, setFront] = useState<0 | 1>(0)
  const [bootLoading, setBootLoading] = useState(false)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadGenRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const frontBufRef = useRef<Buf | null>(null)
  const frontIdxRef = useRef<0 | 1>(0)
  const failStreakRef = useRef(0)
  frontBufRef.current = bufs[front]
  frontIdxRef.current = front

  const path = active ? slideshowCurrentPath(active) : null
  const listLen = active ? slideshowLength(active) : 0
  const [prefetchPath, setPrefetchPath] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !active || active.status === 'building' || listLen <= 1) {
      setPrefetchPath(null)
      return
    }
    const nextIdx = (active.index + 1) % listLen
    if (active.compiledMode) {
      let cancelled = false
      void call(api.slideshow.compiledPathAt({ index: nextIdx }))
        .then((r) => {
          if (!cancelled) setPrefetchPath(r.path)
        })
        .catch(() => {
          if (!cancelled) setPrefetchPath(null)
        })
      return () => {
        cancelled = true
      }
    }
    setPrefetchPath(active.paths[nextIdx] ?? null)
  }, [enabled, active, active?.index, active?.compiledMode, listLen, active?.currentPath])

  // Present `path` via back buffer → decode → double-rAF swap (V-Sync).
  // Unloadable / undecodable images are skipped (do not interrupt autoplay).
  // Empty playlist (compiled Clear / no counts) keeps the overlay up as a blank screen.
  useEffect(() => {
    if (!enabled || !active || active.status === 'building') return
    if (!path) {
      loadGenRef.current += 1
      failStreakRef.current = 0
      setBufs([null, null])
      setBootLoading(false)
      return
    }
    if (
      frontBufRef.current?.path === path &&
      frontBufRef.current.rev === imageRevision
    ) {
      failStreakRef.current = 0
      setBootLoading(false)
      return
    }

    const gen = ++loadGenRef.current
    let cancelled = false
    const hadFront = frontBufRef.current !== null
    if (!hadFront) setBootLoading(true)

    const skip = (): void => {
      if (cancelled || gen !== loadGenRef.current) return
      setBootLoading(false)
      const total = listLen
      failStreakRef.current += 1
      if (total > 0 && failStreakRef.current >= Math.min(total, 64)) {
        failStreakRef.current = 0
        if (active?.compiledMode) {
          // Stay on black compiled session — lists window can add counts back.
          setBufs([null, null])
          return
        }
        void stopSlideshow()
        notify('No displayable images left — slideshow stopped', true)
        return
      }
      slideshowSkipUnloadable()
    }

    void (async () => {
      try {
        const res = await api.preview.get({ path })
        if (cancelled || gen !== loadGenRef.current) return
        if (!res.ok || !res.value.mediaUrl) {
          skip()
          return
        }
        const mediaUrl = res.value.mediaUrl
        const probe = new Image()
        probe.decoding = 'async'
        probe.src = mediaUrl
        try {
          if (typeof probe.decode === 'function') await probe.decode()
          else await waitImgLoad(probe)
        } catch {
          skip()
          return
        }
        if (cancelled || gen !== loadGenRef.current) return
        if (!probe.complete || probe.naturalWidth <= 0) {
          skip()
          return
        }

        failStreakRef.current = 0
        const backIdx: 0 | 1 = frontIdxRef.current === 0 ? 1 : 0
        const slot: Buf = { url: mediaUrl, path, rev: imageRevision }
        setBufs((prev) => {
          const next: [Buf | null, Buf | null] = [prev[0], prev[1]]
          next[backIdx] = slot
          return next
        })

        // Two rAFs: wait until the back <img> has been committed, then swap on V-Sync.
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            if (cancelled || gen !== loadGenRef.current) return
            setFront(backIdx)
            setBootLoading(false)
          })
        })
      } catch {
        skip()
      }
    })()

    return () => {
      cancelled = true
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [
    enabled,
    path,
    active,
    active?.status,
    listLen,
    active?.compiledMode,
    imageRevision,
    slideshowSkipUnloadable,
    stopSlideshow,
    notify
  ])

  // Prefetch / warm-decode the next frame while the current one is on screen.
  useEffect(() => {
    if (!enabled || !prefetchPath || prefetchPath === path) return
    let cancelled = false
    void api.preview.get({ path: prefetchPath }).then((res) => {
      if (cancelled || !res.ok || !res.value.mediaUrl) return
      const img = new Image()
      img.decoding = 'async'
      img.src = res.value.mediaUrl
      void img.decode?.().catch(() => {})
    })
    return () => {
      cancelled = true
    }
  }, [enabled, prefetchPath, path, imageRevision])

  // Auto-advance only after the front buffer matches the logical path (no early flip).
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!enabled || !active || active.status !== 'playing' || listLen === 0) return
    if (imageEditorOpen || dialogOpen) return
    const shown = bufs[front]
    if (!shown || shown.path !== path || shown.rev !== imageRevision) return
    timerRef.current = setTimeout(() => slideshowAdvanceAuto(), delayMs)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [
    enabled,
    active,
    active?.status,
    active?.index,
    active?.paths.length,
    listLen,
    delayMs,
    slideshowAdvanceAuto,
    bufs,
    front,
    path,
    imageRevision,
    imageEditorOpen,
    dialogOpen
  ])

  useEffect(() => {
    if (!enabled || !active) return

    const handleKey = (e: SlideshowKeyLike): void => {
      if (dialogOpen || imageEditorOpen || contextMenuOpen) return

      if (isStopSlideshowKey(e)) {
        void stopSlideshow()
        return
      }
      if (active.status === 'building') return

      if (isEditImageSlideshowKey(e)) {
        const cur = slideshowCurrentPath(active)
        if (!cur || !isEditableImagePath(cur)) {
          notify('This image type cannot be edited in-app', true)
          return
        }
        if (active.status === 'playing') slideshowInterrupt()
        void (async () => {
          const buffered =
            frontBufRef.current?.path === cur ? frontBufRef.current.url : null
          if (buffered) {
            openImageEditor(cur, buffered)
            return
          }
          const res = await api.preview.get({ path: cur })
          if (res.ok && res.value.mediaUrl) {
            openImageEditor(cur, res.value.mediaUrl)
          } else {
            notify(res.ok ? 'No image preview available' : res.error.message, true)
          }
        })()
        return
      }

      // Auto → manual (wheel already does interrupt + navigate).
      if (active.status === 'playing') slideshowInterrupt()

      if (isNumpadCode(e.code)) return
      if (isPipeUndoKey(e)) {
        slideshowUndoAction()
        return
      }
      if (e.key === 'Home') {
        slideshowNavigate('first')
        return
      }
      if (e.key === 'End') {
        slideshowNavigate('last')
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        slideshowNavigate(-1)
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        slideshowNavigate(1)
        return
      }
      const token = mapTokenFromEvent(e)
      if (token) {
        const row = map.find(
          (r) => normalizeKeyToken(r.keyToken)?.toUpperCase() === token.toUpperCase()
        )
        if (row) slideshowMapAction(row)
      }
    }

    const onKey = (e: KeyboardEvent): void => {
      if (dialogOpen || imageEditorOpen || contextMenuOpen) return
      e.preventDefault()
      e.stopPropagation()
      handleKey(e)
    }

    // Keys from the Compiled lists window (it keeps focus while the slideshow runs).
    const unsubRelay = api.onEvent((event) => {
      if (event.type !== 'slideshow-key') return
      handleKey(event.payload)
    })

    // Wheel = Up/Down arrows: interrupt auto → manual, then prev/next.
    let wheelLock = false
    const onWheel = (e: WheelEvent): void => {
      if (dialogOpen || imageEditorOpen || contextMenuOpen) return
      if (active.status === 'building') return
      // Leave Ctrl/⌘+wheel to app font-size handling.
      if (e.ctrlKey || e.metaKey) return
      if (Math.abs(e.deltaY) < 2 && Math.abs(e.deltaX) < 2) return
      e.preventDefault()
      e.stopPropagation()
      if (wheelLock) return
      wheelLock = true
      if (active.status === 'playing') slideshowInterrupt()
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
      // Same sense as ArrowUp / ArrowDown: up notch → previous, down → next.
      slideshowNavigate(delta < 0 ? -1 : 1)
      window.setTimeout(() => {
        wheelLock = false
      }, 160)
    }

    window.addEventListener('keydown', onKey, true)
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('wheel', onWheel, true)
      unsubRelay()
    }
  }, [
    enabled,
    active,
    map,
    dialogOpen,
    imageEditorOpen,
    contextMenuOpen,
    stopSlideshow,
    slideshowInterrupt,
    slideshowNavigate,
    slideshowMapAction,
    slideshowUndoAction,
    openImageEditor,
    notify
  ])

  useEffect(() => {
    if (!enabled || !active) {
      loadGenRef.current += 1
      failStreakRef.current = 0
      setBufs([null, null])
      setFront(0)
      setBootLoading(false)
    }
  }, [enabled, active])

  const slideshowLive = Boolean(enabled && active)
  const cursorHidden = useIdleCursorHide(
    slideshowLive && !imageEditorOpen && !dialogOpen && !contextMenuOpen
  )

  if (!enabled || !active) return null

  const shown = bufs[front]
  const captionPath = shown?.path ?? path
  const caption =
    drawCaption && captionPath
      ? `${basename(captionPath)}  (${active.index + 1}/${listLen})`
      : null

  return (
    <div
      className={`slideshow-overlay${cursorHidden ? ' cursor-hidden' : ''}`}
      role="dialog"
      aria-label="Slideshow"
      onClick={() => {
        if (!dialogOpen && !imageEditorOpen && !contextMenuOpen) void stopSlideshow()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const cur = slideshowCurrentPath(active)
        openContextMenu({
          x: e.clientX,
          y: e.clientY,
          paths: cur ? [cur] : [],
          slideshow: true
        })
      }}
    >
      <div className="slideshow-stage">
        {active.status === 'building' && (
          <div className="slideshow-loading">
            <SpinnerIcon />
            <span>Building image list…</span>
          </div>
        )}
        {active.status !== 'building' && bootLoading && !shown && (
          <div className="slideshow-loading">
            <SpinnerIcon />
          </div>
        )}

        <img
          className={`slideshow-image slideshow-buf${front === 0 ? ' is-front' : ' is-back'}`}
          src={bufs[0]?.url || undefined}
          alt=""
          draggable={false}
          decoding="async"
          hidden={!bufs[0]?.url}
        />
        <img
          className={`slideshow-image slideshow-buf${front === 1 ? ' is-front' : ' is-back'}`}
          src={bufs[1]?.url || undefined}
          alt=""
          draggable={false}
          decoding="async"
          hidden={!bufs[1]?.url}
        />

        {caption && <div className="slideshow-caption">{caption}</div>}
        {map.length === 0 && active.status === 'manual' && (
          <div className="slideshow-hint">
            No categorizer map loaded — load one in Settings → Slideshow. Delete/categorize keys inactive.
          </div>
        )}
      </div>
    </div>
  )
}

function waitImgLoad(img: HTMLImageElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve()
      return
    }
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('image load failed'))
  })
}

function mapTokenFromEvent(e: SlideshowKeyLike): string | null {
  // Prefer KeyboardEvent.code → Forms.Keys (handles OemMinus, Back, O, …)
  return codeToKeyToken(e.code)
}
