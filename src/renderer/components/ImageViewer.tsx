import { useEffect, useState, type JSX, type MouseEvent } from 'react'
import { useAppStore } from '../store/appStore'
import { api } from '../lib/ipc'
import { basename } from '../lib/paths'
import { CloseIcon, ArrowLeft, ArrowRight, SpinnerIcon } from '../lib/icons'

/**
 * Full-window image viewer for double-click / Enter.
 * Loads via preview:get so PSD and protocol allowlisting stay correct.
 */
export function ImageViewer(): JSX.Element | null {
  const viewer = useAppStore((s) => s.imageViewer)
  const closeImageViewer = useAppStore((s) => s.closeImageViewer)
  const imageViewerNavigate = useAppStore((s) => s.imageViewerNavigate)
  const imageViewerDelete = useAppStore((s) => s.imageViewerDelete)
  const openPath = useAppStore((s) => s.openPath)
  const dialogOpen = useAppStore((s) => s.dialog !== null)

  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fit, setFit] = useState(true)

  const viewerPath = viewer?.path ?? null

  useEffect(() => {
    if (!viewerPath) return
    let alive = true
    setLoading(true)
    setError(null)
    setFit(true)
    // Keep the previous bitmap mounted until the next URL is ready (no black flash).
    void api.preview.get({ path: viewerPath }).then((res) => {
      if (!alive) return
      setLoading(false)
      if (!res.ok || !res.value.mediaUrl) {
        setError(res.ok ? 'No image preview available' : res.error.message)
        setUrl(null)
        return
      }
      setUrl(res.value.mediaUrl)
    })
    return () => {
      alive = false
    }
  }, [viewerPath])

  useEffect(() => {
    if (!viewer) return
    const onKey = (e: KeyboardEvent): void => {
      // Let confirm/settings modals own the keyboard while open.
      if (dialogOpen) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeImageViewer()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        imageViewerNavigate(-1)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault()
        imageViewerNavigate(1)
      } else if (e.key === 'Home') {
        e.preventDefault()
        imageViewerNavigate('first')
      } else if (e.key === 'End') {
        e.preventDefault()
        imageViewerNavigate('last')
      } else if (e.key === 'Delete') {
        e.preventDefault()
        e.stopPropagation()
        void imageViewerDelete(e.shiftKey)
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setFit((f) => !f)
      }
    }
    // Wheel: navigate siblings (debounce so one notch ≈ one image).
    let wheelLock = false
    const onWheel = (e: WheelEvent): void => {
      if (dialogOpen) return
      // Ctrl/⌘+wheel adjusts app font size (ExplorerShell) — don't change images.
      if (e.ctrlKey || e.metaKey) return
      // In actual-size mode, let the frame scroll instead of changing images.
      if (!fit) return
      if (Math.abs(e.deltaY) < 2 && Math.abs(e.deltaX) < 2) return
      e.preventDefault()
      if (wheelLock) return
      wheelLock = true
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
      imageViewerNavigate(delta > 0 ? 1 : -1)
      window.setTimeout(() => {
        wheelLock = false
      }, 180)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('wheel', onWheel, true)
    }
  }, [viewer, dialogOpen, fit, closeImageViewer, imageViewerNavigate, imageViewerDelete])

  if (!viewer) return null

  const idx = viewer.siblings.findIndex((p) => p.toLowerCase() === viewer.path.toLowerCase())
  const pos = idx >= 0 ? idx + 1 : 1
  const total = viewer.siblings.length
  const name = basename(viewer.path)

  const dismissIfAway = (e: MouseEvent): void => {
    const t = e.target
    if (!(t instanceof Element)) return
    // Keep chrome / image / status interactive; dismiss on empty stage/frame.
    if (t.closest('img, button, a, .image-viewer-bar, .image-viewer-status')) {
      return
    }
    closeImageViewer()
  }

  return (
    <div
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Image: ${name}`}
      onMouseDown={dismissIfAway}
    >
      <header className="image-viewer-bar">
        <div className="image-viewer-title">
          <span className="image-viewer-name" title={viewer.path}>
            {name}
          </span>
          {total > 1 && (
            <span className="image-viewer-pos">
              {pos} / {total}
            </span>
          )}
        </div>
        <div className="image-viewer-actions">
          <button
            type="button"
            className="btn"
            onClick={() => void openPath(viewer.path)}
            title="Open with default app"
          >
            Open with default app
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            title="Close (Esc)"
            onClick={closeImageViewer}
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="image-viewer-stage" onMouseDown={dismissIfAway}>
        {total > 1 && (
          <button
            type="button"
            className="image-viewer-nav prev"
            aria-label="Previous image"
            onClick={() => imageViewerNavigate(-1)}
          >
            <ArrowLeft size={22} />
          </button>
        )}

        <div
          className={`image-viewer-frame${fit ? ' fit' : ' actual'}`}
          onMouseDown={dismissIfAway}
        >
          {loading && !url && (
            <div className="image-viewer-status">
              <SpinnerIcon size={28} className="spin" />
            </div>
          )}
          {!loading && error && <div className="image-viewer-status">{error}</div>}
          {url && !error && (
            <img
              src={url}
              alt={name}
              draggable={false}
              onClick={() => setFit((f) => !f)}
              title={fit ? 'Click for actual size' : 'Click to fit'}
            />
          )}
        </div>

        {total > 1 && (
          <button
            type="button"
            className="image-viewer-nav next"
            aria-label="Next image"
            onClick={() => imageViewerNavigate(1)}
          >
            <ArrowRight size={22} />
          </button>
        )}
      </div>
    </div>
  )
}
