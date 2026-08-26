import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { basename } from '../lib/paths'
import { isEditableImagePath } from '@shared/imageEdit'
import {
  applyCropStep,
  EMPTY_SLIDESHOW_CROP,
  hasSlideshowCrop,
  numpadCropStepPct,
  type SlideshowAccumulatedCrop,
  type SlideshowCropEdge
} from '@shared/slideshow/crop'
import {
  isEditImageSlideshowKey,
  isNumpadCode,
  isPipeUndoKey,
  isSlideshowCropCancelKey,
  isSlideshowCropSaveKey,
  isSlideshowStopKey,
  isSlideshowTitleFilenameToggleKey,
  numpadCropEdgeFromCode,
  codeToKeyToken,
  normalizeKeyToken,
  type SlideshowKeyLike
} from '@shared/slideshow/keys'
import { SpinnerIcon } from '../lib/icons'
import { slideshowCurrentPath, slideshowLiveLength } from '../lib/slideshowTypes'
import {
  folderPathAt,
  folderPlaylistNextIndex,
  folderPlaylistSkippedSize
} from '../lib/folderPlaylist'
import { useIdleCursorHide } from '../lib/useIdleCursorHide'
import { tryCaptionPosterUrl } from '../lib/captionPoster'
import {
  drawSlideshowCropPreview,
  loadCropOriginalBitmap,
  type CropOriginalBitmap
} from '../lib/slideshowCropPreview'

type Buf = { url: string; path: string; rev: number; poster: boolean; slideKey: string }

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
  const drawCaption = useAppStore(
    (s) => s.devGateActive && s.settings.slideshow.drawCaption
  )
  const delayMs = useAppStore((s) => s.settings.slideshow.delayMs)
  const loop = useAppStore((s) => s.settings.slideshow.loop)
  const stopSlideshow = useAppStore((s) => s.stopSlideshow)
  const slideshowInterrupt = useAppStore((s) => s.slideshowInterrupt)
  const slideshowResumePlaying = useAppStore((s) => s.slideshowResumePlaying)
  const slideshowCropSave = useAppStore((s) => s.slideshowCropSave)
  const slideshowNavigate = useAppStore((s) => s.slideshowNavigate)
  const slideshowMapAction = useAppStore((s) => s.slideshowMapAction)
  const slideshowUndoAction = useAppStore((s) => s.slideshowUndoAction)
  const slideshowAdvanceAuto = useAppStore((s) => s.slideshowAdvanceAuto)
  const slideshowSkipUnloadable = useAppStore((s) => s.slideshowSkipUnloadable)
  const openImageEditor = useAppStore((s) => s.openImageEditor)
  const openContextMenu = useAppStore((s) => s.openContextMenu)
  const notify = useAppStore((s) => s.notify)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const dialogOpen = useAppStore((s) => s.dialog !== null)
  const imageEditorOpen = useAppStore((s) => s.imageEditor !== null)
  const contextMenuOpen = useAppStore((s) => s.contextMenu !== null)

  const [bufs, setBufs] = useState<[Buf | null, Buf | null]>([null, null])
  const [front, setFront] = useState<0 | 1>(0)
  const [bootLoading, setBootLoading] = useState(false)
  const [cropMode, setCropMode] = useState(false)
  const [cropAcc, setCropAcc] = useState<SlideshowAccumulatedCrop>(EMPTY_SLIDESHOW_CROP)

  const cropModeRef = useRef(false)
  const cropAccRef = useRef<SlideshowAccumulatedCrop>(EMPTY_SLIDESHOW_CROP)
  const cropBitmapRef = useRef<CropOriginalBitmap | null>(null)
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const cropSavingRef = useRef(false)
  /** Live Shift/Ctrl state for numpad crop steps (read before async bitmap load). */
  const cropModsRef = useRef({ shift: false, ctrl: false })

  const syncCropMods = useCallback((e: SlideshowKeyLike): void => {
    cropModsRef.current = {
      shift: !!e.shiftKey,
      ctrl: !!(e.ctrlKey || e.metaKey)
    }
  }, [])

  const setCropModeBoth = useCallback((on: boolean): void => {
    cropModeRef.current = on
    setCropMode(on)
  }, [])

  const resetCrop = useCallback((): void => {
    cropBitmapRef.current = null
    cropAccRef.current = EMPTY_SLIDESHOW_CROP
    setCropAcc(EMPTY_SLIDESHOW_CROP)
    setCropModeBoth(false)
  }, [setCropModeBoth])

  const syncCropAcc = useCallback((next: SlideshowAccumulatedCrop): void => {
    cropAccRef.current = next
    setCropAcc(next)
  }, [])

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadGenRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const frontBufRef = useRef<Buf | null>(null)
  const frontIdxRef = useRef<0 | 1>(0)
  const failStreakRef = useRef(0)
  useEffect(() => {
    frontBufRef.current = bufs[front]
    frontIdxRef.current = front
  }, [bufs, front])

  const path = active ? slideshowCurrentPath(active) : null
  const listLen = active ? slideshowLiveLength(active) : 0
  const showCropPreview = cropMode || hasSlideshowCrop(cropAcc)
  const [prefetchPath, setPrefetchPath] = useState<string | null>(null)
  const skippedSize = active && !active.compiledMode ? folderPlaylistSkippedSize() : 0

  useEffect(() => {
    resetCrop()
  }, [path, active?.index, resetCrop])

  useEffect(() => {
    if (!enabled || !active || active.status === 'building' || listLen <= 1) {
      setPrefetchPath(null)
      return
    }
    const nextIdx = active.compiledMode
      ? (active.index + 1) % listLen
      : folderPlaylistNextIndex(active.index, 1, loop)
    if (nextIdx == null) {
      setPrefetchPath(null)
      return
    }
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
    setPrefetchPath(folderPathAt(nextIdx))
  }, [enabled, active, skippedSize, listLen, loop])

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
    const slideKey = `${path}#${active.index}#${imageRevision}#${drawCaption ? '1' : '0'}`
    if (frontBufRef.current?.slideKey === slideKey) {
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
        let mediaUrl: string | null = null
        let poster = false
        const res = await api.preview.getDisplayUrl({ path })
        if (cancelled || gen !== loadGenRef.current) return
        if (!res.ok || !res.value.mediaUrl) {
          skip()
          return
        }
        mediaUrl = res.value.mediaUrl
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
        if (drawCaption) {
          const framed = await tryCaptionPosterUrl(path, probe)
          if (cancelled || gen !== loadGenRef.current) return
          if (framed) {
            mediaUrl = framed
            poster = true
          }
        }

        failStreakRef.current = 0
        const backIdx: 0 | 1 = frontIdxRef.current === 0 ? 1 : 0
        const slot: Buf = { url: mediaUrl, path, rev: imageRevision, poster, slideKey }
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
    listLen,
    imageRevision,
    drawCaption,
    slideshowSkipUnloadable,
    stopSlideshow,
    notify
  ])

  // Prefetch / warm-decode the next frame while the current one is on screen.
  useEffect(() => {
    if (!enabled || !prefetchPath || prefetchPath === path) return
    let cancelled = false
    void api.preview.getDisplayUrl({ path: prefetchPath }).then((res) => {
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

  // Crop preview canvas
  useEffect(() => {
    if (!showCropPreview || !cropBitmapRef.current) return
    const canvas = cropCanvasRef.current
    if (!canvas) return
    drawSlideshowCropPreview(canvas, cropBitmapRef.current, cropAccRef.current)
    const stage = canvas.parentElement
    if (!stage) return
    const ro = new ResizeObserver(() => {
      if (cropBitmapRef.current) {
        drawSlideshowCropPreview(canvas, cropBitmapRef.current, cropAccRef.current)
      }
    })
    ro.observe(stage)
    return () => ro.disconnect()
  }, [showCropPreview, cropAcc, cropMode, path])

  useEffect(() => {
    if (!enabled || !active) return

    const ensureBitmap = async (imagePath: string): Promise<boolean> => {
      if (cropBitmapRef.current?.path === imagePath) return true
      try {
        cropBitmapRef.current = await loadCropOriginalBitmap(imagePath)
        return true
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), true)
        return false
      }
    }

    const applyCropEdge = async (edge: SlideshowCropEdge, e: SlideshowKeyLike): Promise<void> => {
      syncCropMods(e)
      const step = numpadCropStepPct(cropModsRef.current.shift, cropModsRef.current.ctrl)
      const cur = slideshowCurrentPath(active)
      if (!cur || !isEditableImagePath(cur)) {
        notify('This image type cannot be cropped in-app', true)
        return
      }
      if (!(await ensureBitmap(cur))) return
      try {
        syncCropAcc(applyCropStep(cropAccRef.current, edge, step))
        setCropModeBoth(true)
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), true)
      }
    }

    const saveCrop = async (): Promise<boolean> => {
      if (cropSavingRef.current) return false
      const cur = slideshowCurrentPath(active)
      if (!cur || !hasSlideshowCrop(cropAccRef.current)) {
        resetCrop()
        return true
      }
      cropSavingRef.current = true
      try {
        const ok = await slideshowCropSave(cur, cropAccRef.current)
        if (ok) resetCrop()
        return ok
      } finally {
        cropSavingRef.current = false
      }
    }

    const saveCropAndNavigate = async (nav: -1 | 1 | 'first' | 'last'): Promise<void> => {
      const ok = await saveCrop()
      if (!ok) return
      slideshowNavigate(nav)
    }

    const cancelCropAndNavigate = (nav: -1 | 1): void => {
      resetCrop()
      slideshowNavigate(nav)
    }

    const handleKey = (e: SlideshowKeyLike): void => {
      syncCropMods(e)
      if (dialogOpen || imageEditorOpen || contextMenuOpen) return

      if (isSlideshowTitleFilenameToggleKey(e)) {
        const cur = useAppStore.getState().settings.slideshow.titleFilename === true
        void applySettingsPatch({ slideshow: { titleFilename: !cur } })
        return
      }

      if (cropModeRef.current) {
        if (isSlideshowCropSaveKey(e)) {
          void saveCrop()
          return
        }
        if (isSlideshowCropCancelKey(e)) {
          resetCrop()
          return
        }
        const edge = numpadCropEdgeFromCode(e.code)
        if (edge) {
          void applyCropEdge(edge, e)
          return
        }
        if (e.key === 'Home') {
          void saveCropAndNavigate('first')
          return
        }
        if (e.key === 'End') {
          void saveCropAndNavigate('last')
          return
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
          void saveCropAndNavigate(-1)
          return
        }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
          void saveCropAndNavigate(1)
          return
        }
        if (e.key === 'Backspace') {
          cancelCropAndNavigate(-1)
          return
        }
        if (e.key === 'Delete') {
          cancelCropAndNavigate(1)
          return
        }
        return
      }

      if (isSlideshowStopKey(e)) {
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

      const cropEdge = numpadCropEdgeFromCode(e.code)
      if (cropEdge) {
        if (active.status === 'playing') slideshowInterrupt()
        void applyCropEdge(cropEdge, e)
        return
      }

      if (isSlideshowCropSaveKey(e)) {
        if (active.status === 'manual') slideshowResumePlaying()
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
      syncCropMods(e)
      if (dialogOpen || imageEditorOpen || contextMenuOpen) return
      e.preventDefault()
      e.stopPropagation()
      handleKey(e)
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      syncCropMods(e)
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
      if (cropModeRef.current) return
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
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKeyUp, true)
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
    slideshowResumePlaying,
    slideshowCropSave,
    slideshowNavigate,
    slideshowMapAction,
    slideshowUndoAction,
    openImageEditor,
    notify,
    applySettingsPatch,
    resetCrop,
    syncCropAcc,
    syncCropMods,
    setCropModeBoth
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
    drawCaption && captionPath && !shown?.poster
      ? `${basename(captionPath)}  (${active.index + 1}/${listLen})`
      : null

  return (
    <div
      className={`slideshow-overlay${cursorHidden ? ' cursor-hidden' : ''}`}
      role="dialog"
      aria-label="Slideshow"
      onClick={() => {
        if (cropMode) return
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
          hidden={!bufs[0]?.url || showCropPreview}
        />
        <img
          className={`slideshow-image slideshow-buf${front === 1 ? ' is-front' : ' is-back'}`}
          src={bufs[1]?.url || undefined}
          alt=""
          draggable={false}
          decoding="async"
          hidden={!bufs[1]?.url || showCropPreview}
        />

        {showCropPreview && (
          <canvas
            ref={cropCanvasRef}
            className="slideshow-image slideshow-crop-canvas is-front"
            aria-hidden
          />
        )}

        {caption && !showCropPreview && <div className="slideshow-caption">{caption}</div>}
        {cropMode && (
          <div className="slideshow-hint slideshow-crop-hint">
            Crop — 2/4/6/8 trim (5%; Shift 2.5%; Ctrl 1%; Shift+Ctrl 0.5%) · Enter/0 save · Esc/5 cancel ·
            arrows/PgUp/PgDn/Home/End save &amp; go · Backspace/Delete discard &amp; go
          </div>
        )}
        {!cropMode && map.length === 0 && active.status === 'manual' && (
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
