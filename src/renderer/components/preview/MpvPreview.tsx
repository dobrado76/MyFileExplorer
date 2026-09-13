import { useEffect, useRef, useState, type JSX, type MouseEvent, type PointerEvent } from 'react'
import { api } from '../../lib/ipc'
import { usePointerIdle } from '../../lib/usePointerIdle'
import { useAppStore } from '../../store/appStore'
import { mpvPointerInVideoToggleZone } from '@shared/mpvClickPause'

/**
 * Host for opt-in Rich player (mpv). Reports DIP bounds to main; main places
 * an owned borderless mpv overlay over this rectangle (D33 — not --wid / WS_CHILD).
 */
export function MpvPreview({
  path,
  posterUrl,
  autoplay,
  active = true,
  startAtSec,
  autoHideControls = false,
  onOpenExternal,
  onFailed
}: {
  path: string
  posterUrl?: string
  autoplay?: boolean
  active?: boolean
  /** Resume offset (seconds) for Now Playing handoff. */
  startAtSec?: number
  /**
   * Detached preview / Now Playing: hide mpv OSC after idle; Chromium owns
   * the mouse, so we drive OSC via IPC instead of mpv auto mode.
   */
  autoHideControls?: boolean
  onOpenExternal(): void
  onFailed?: (message: string) => void
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'starting' | 'playing' | 'error'>('starting')
  const [error, setError] = useState<string | null>(null)
  const startedFor = useRef<string | null>(null)
  const autoplayRef = useRef(autoplay)
  const startAtSecRef = useRef(startAtSec)
  autoplayRef.current = autoplay
  startAtSecRef.current = startAtSec
  const overlayBlocked = useAppStore(
    (s) => s.dialog != null || s.contextMenu != null || s.imageViewer != null
  )
  const playingSinceRef = useRef(0)
  const pressRef = useRef<{ x: number; y: number } | null>(null)
  const controlsIdle = usePointerIdle(
    Boolean(autoHideControls && active && status === 'playing'),
    3000,
    { listenMpvPointer: autoHideControls }
  )

  const onVideoPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    pressRef.current = { x: e.clientX, y: e.clientY }
  }

  const onVideoClick = (e: MouseEvent<HTMLDivElement>): void => {
    if (status !== 'playing') return
    // Docked: mpv HWND owns the click (main-process watch). Detached: Chromium may.
    if (!autoHideControls) return
    // Ignore the mouseup that opened Keep playing / Dock.
    if (Date.now() - playingSinceRef.current < 400) return
    const p = pressRef.current
    pressRef.current = null
    // Caption drag / click-drag is not “click the video”.
    if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) return
    const r = e.currentTarget.getBoundingClientRect()
    if (!mpvPointerInVideoToggleZone(e.clientY - r.top, r.height, !controlsIdle)) return
    void api.preview.mpvCyclePause()
  }

  useEffect(() => {
    if (status !== 'playing') return
    void api.preview.mpvVisible({ visible: !overlayBlocked })
  }, [overlayBlocked, status])

  useEffect(() => {
    if (!autoHideControls || status !== 'playing') return
    void api.preview.mpvOscVisible({ visible: !controlsIdle })
  }, [autoHideControls, controlsIdle, status])

  useEffect(() => {
    if (!autoHideControls || status !== 'playing') return
    void api.preview.mpvPointerWatch({ enabled: true })
    return () => {
      void api.preview.mpvPointerWatch({ enabled: false })
    }
  }, [autoHideControls, status])

  useEffect(() => {
    if (!active) {
      void api.preview.mpvStop()
      startedFor.current = null
      return
    }

    const host = hostRef.current
    if (!host) return

    let cancelled = false
    let ro: ResizeObserver | null = null
    let raf = 0
    let lastSent = ''

    const boundsFromHost = (): { x: number; y: number; width: number; height: number } => {
      const r = host.getBoundingClientRect()
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.max(32, Math.round(r.width)),
        height: Math.max(32, Math.round(r.height))
      }
    }

    const pushBounds = (): void => {
      if (cancelled) return
      const b = boundsFromHost()
      const key = `${b.x},${b.y},${b.width},${b.height}`
      if (key === lastSent) return
      lastSent = key
      void api.preview.mpvBounds({ bounds: b })
    }

    const start = async (): Promise<void> => {
      setStatus('starting')
      setError(null)
      let lastKey = ''
      let bounds = boundsFromHost()
      for (let i = 0; i < 8; i++) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        if (cancelled) return
        bounds = boundsFromHost()
        const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
        if (key === lastKey && bounds.width >= 32 && bounds.height >= 32) break
        lastKey = key
      }
      if (cancelled) return
      if (bounds.width < 32 || bounds.height < 32) {
        const msg = 'Preview area is too small for Rich player'
        setStatus('error')
        setError(msg)
        onFailed?.(msg)
        return
      }
      const handoffAt = startAtSecRef.current
      const res = await api.preview.mpvStart({
        path,
        bounds,
        autoplay: Boolean(autoplayRef.current),
        ...(handoffAt != null && handoffAt > 0 ? { startAtSec: handoffAt } : {})
      })
      if (cancelled) {
        void api.preview.mpvStop()
        return
      }
      if (!res.ok) {
        const msg = res.error?.message || 'Rich player failed to start'
        setStatus('error')
        setError(msg)
        onFailed?.(msg)
        startedFor.current = null
        return
      }
      startedFor.current = path
      lastSent = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
      playingSinceRef.current = Date.now()
      setStatus('playing')
      pushBounds()
    }

    void start()

    ro = new ResizeObserver(() => pushBounds())
    ro.observe(host)

    const onWinResize = (): void => pushBounds()
    window.addEventListener('resize', onWinResize)

    const tick = (): void => {
      pushBounds()
      raf = window.setTimeout(tick, 250) as unknown as number
    }
    raf = window.setTimeout(tick, 250) as unknown as number

    return () => {
      cancelled = true
      ro?.disconnect()
      window.removeEventListener('resize', onWinResize)
      window.clearTimeout(raf)
      if (startedFor.current === path) {
        startedFor.current = null
        void api.preview.mpvStop()
      }
    }
    // path/active only — startAtSec/autoplay are latched at start via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handoff props must not restart mpv
  }, [path, active])

  if (!active) {
    if (!posterUrl) return <div className="preview-mpv-host preview-mpv-host-idle" />
    return (
      <div className="preview-av-fallback preview-av-poster">
        <img className="preview-video-poster" src={posterUrl} alt="" draggable={false} />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className={`preview-av-fallback${posterUrl ? ' preview-av-poster' : ''}`}>
        {posterUrl ? (
          <img className="preview-video-poster" src={posterUrl} alt="" draggable={false} />
        ) : null}
        <p>{error || 'Rich player unavailable.'}</p>
        <button type="button" className="btn" onClick={onOpenExternal}>
          Open with default app
        </button>
      </div>
    )
  }

  return (
    <div
      className="preview-mpv-host"
      ref={hostRef}
      data-mpv-status={status}
      onPointerDown={onVideoPointerDown}
      onClick={onVideoClick}
    >
      {status === 'starting' ? (
        <>
          {posterUrl ? (
            <img className="preview-video-poster" src={posterUrl} alt="" draggable={false} />
          ) : null}
          <p className="preview-mpv-status">Starting Rich player…</p>
        </>
      ) : null}
    </div>
  )
}
