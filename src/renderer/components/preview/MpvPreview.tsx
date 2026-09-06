import { useEffect, useRef, useState, type JSX } from 'react'
import { api } from '../../lib/ipc'

/**
 * Host for opt-in Rich player (mpv). Reports DIP bounds to main; main embeds
 * mpv via --wid on a native WS_CHILD surface over this rectangle (D33).
 */
export function MpvPreview({
  path,
  posterUrl,
  autoplay,
  active = true,
  onOpenExternal,
  onFailed
}: {
  path: string
  posterUrl?: string
  autoplay?: boolean
  active?: boolean
  onOpenExternal(): void
  onFailed?: (message: string) => void
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'starting' | 'playing' | 'error'>('starting')
  const [error, setError] = useState<string | null>(null)
  const startedFor = useRef<string | null>(null)

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
      if (cancelled || startedFor.current !== path) return
      const b = boundsFromHost()
      const key = `${b.x},${b.y},${b.width},${b.height}`
      if (key === lastSent) return
      lastSent = key
      void api.preview.mpvBounds({ bounds: b })
    }

    const start = async (): Promise<void> => {
      setStatus('starting')
      setError(null)
      // Wait for layout (media hero / flex) so the first HWND rect is correct.
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      if (cancelled) return
      const bounds = boundsFromHost()
      if (bounds.width < 32 || bounds.height < 32) {
        const msg = 'Preview area is too small for Rich player'
        setStatus('error')
        setError(msg)
        onFailed?.(msg)
        return
      }
      const res = await api.preview.mpvStart({
        path,
        bounds,
        autoplay: Boolean(autoplay)
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
      setStatus('playing')
      pushBounds()
    }

    void start()

    ro = new ResizeObserver(() => pushBounds())
    ro.observe(host)

    const onWinResize = (): void => pushBounds()
    window.addEventListener('resize', onWinResize)

    // Layout can shift without resizing the host box (tabs, metadata). Poll lightly.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- path/autoplay/active drive the session
  }, [path, autoplay, active])

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
    <div className="preview-mpv-host" ref={hostRef} data-mpv-status={status}>
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
