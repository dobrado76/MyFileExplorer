import { useEffect, useRef, useState, type JSX } from 'react'
import type { PreviewModel } from '@shared/schemas/preview'
import type { Settings } from '@shared/schemas/settings'
import { mediaPreviewChromeTitle } from '@shared/mediaMetadata'
import { api, call } from '../lib/ipc'
import { basename } from '../lib/paths'
import { DockIcon, SpinnerIcon } from '../lib/icons'
import { peekNowPlayingChromiumPlayback } from '../lib/dockedAvPlayback'
import { useAppStore } from '../store/appStore'
import { VideoPreview, VideoStripPreview } from './preview/RichPreviews'
import { MpvPreview } from './preview/MpvPreview'

function applyChromeSettings(settings: Settings): void {
  const rootEl = document.documentElement
  rootEl.dataset['theme'] = settings.theme === 'custom' ? 'dark' : settings.theme
  const custom = settings.theme === 'custom' ? settings.customTheme : null
  const vars: Record<string, string | null> = {
    '--bg': custom?.bg ?? null,
    '--bg-elevated': custom?.bgElevated ?? null,
    '--bg-panel': custom?.bg ?? null,
    '--border': custom?.border ?? null,
    '--text': custom?.text ?? null,
    '--text-dim': custom?.textDim ?? null,
    '--accent': custom?.accent ?? null
  }
  for (const [k, v] of Object.entries(vars)) {
    if (v) rootEl.style.setProperty(k, v)
    else rootEl.style.removeProperty(k)
  }
  rootEl.style.setProperty('--font-family', `'${settings.fontFamily}', system-ui, sans-serif`)
  rootEl.style.setProperty('--font-size', `${settings.fontSizePx}px`)
}

type Handoff = { startAtSec?: number; paused?: boolean }

/**
 * Sticky video player window — path set by main; does not follow Explorer selection.
 * Resumes from `startAtSec` when Keep playing hands off from the docked preview.
 * Dock returns playback to the preview pane at the current position (title-bar Close stops).
 */
export function NowPlayingApp(): JSX.Element {
  const [path, setPath] = useState<string | null>(null)
  const [handoff, setHandoff] = useState<Handoff>({})
  const pathRef = useRef(path)
  pathRef.current = path
  const [model, setModel] = useState<PreviewModel | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chromeTitle, setChromeTitle] = useState<string | null>(null)
  const [richPlayer, setRichPlayer] = useState(false)
  const [booted, setBooted] = useState(false)
  const notify = useAppStore((s) => s.notify)

  useEffect(() => {
    void call(api.settings.get())
      .then((s) => {
        applyChromeSettings(s)
        useAppStore.setState({ settings: s })
        setRichPlayer(s.previewRichPlayerMpv === true)
        setBooted(true)
      })
      .catch(() => {
        document.documentElement.dataset['theme'] = 'dark'
        setBooted(true)
      })
    void call(api.nowPlaying.get()).then((st) => {
      if (st.open && st.path) {
        setPath(st.path)
        setHandoff({ startAtSec: st.startAtSec, paused: st.paused })
      }
    })
    const off = api.onEvent((ev) => {
      if (ev.type === 'now-playing') {
        if (ev.payload.open && ev.payload.path) {
          const next = ev.payload.path
          const prev = pathRef.current
          const pathChanged =
            !prev ||
            prev.replace(/\//g, '\\').toLowerCase() !== next.replace(/\//g, '\\').toLowerCase()
          setPath(next)
          if (pathChanged || ev.payload.startAtSec != null || ev.payload.paused != null) {
            setHandoff({
              startAtSec: ev.payload.startAtSec,
              paused: ev.payload.paused
            })
          }
        } else {
          setPath(null)
          setHandoff({})
          setModel(null)
          setChromeTitle(null)
        }
      }
    })
    return () => off()
  }, [])

  useEffect(() => {
    if (!path) {
      setModel(null)
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setModel(null)
    void (async () => {
      try {
        const [preview, metaRes] = await Promise.all([
          call(api.preview.get({ path })),
          call(api.mediaMetadata.get({ path })).catch(() => null)
        ])
        if (cancelled) return
        setModel(preview)
        const title = metaRes?.metadata
          ? mediaPreviewChromeTitle(metaRes.metadata)
          : null
        setChromeTitle(title || basename(path))
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setChromeTitle(basename(path))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path])

  const dockToPreview = (): void => {
    void (async () => {
      try {
        // Peek only — dock may be rejected if preview is another file; keep playing.
        const chrome = peekNowPlayingChromiumPlayback()
        let startAtSec = chrome?.startAtSec
        let paused = chrome?.paused === true
        if (startAtSec == null || startAtSec <= 0) {
          try {
            const mpv = await call(api.preview.mpvTimePos())
            if (mpv.seconds != null && mpv.seconds > 0) {
              startAtSec = mpv.seconds
            }
          } catch {
            /* no live mpv */
          }
        }
        await call(
          api.nowPlaying.dock({
            ...(startAtSec != null && startAtSec > 0 ? { startAtSec } : {}),
            paused
          })
        )
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), true)
      }
    })()
  }

  if (!booted) {
    return (
      <div className="now-playing">
        <div className="now-playing-empty">
          <SpinnerIcon size={20} className="spin" />
        </div>
      </div>
    )
  }

  const useRich =
    richPlayer && model?.kind === 'video' && !model.mediaUrl && Boolean(path)
  const resumePlaying = handoff.paused !== true
  // Remount player when handoff offset changes so seek applies once.
  const playerKey = `${path ?? ''}|${handoff.startAtSec ?? 0}|${handoff.paused === true ? 1 : 0}`

  return (
    <div className="now-playing">
      <header className="now-playing-header">
        <div className="now-playing-title" title={chromeTitle ?? undefined}>
          {chromeTitle ?? 'Now Playing'}
        </div>
        {path ? (
          <button
            type="button"
            className="icon-btn"
            title="Dock into preview (only if this file is selected)"
            aria-label="Dock into preview pane"
            onClick={dockToPreview}
          >
            <DockIcon size={16} />
          </button>
        ) : null}
      </header>
      <div className="now-playing-body">
        {!path ? (
          <div className="now-playing-empty">Nothing playing</div>
        ) : loading ? (
          <div className="now-playing-empty">
            <SpinnerIcon size={20} className="spin" />
          </div>
        ) : error ? (
          <div className="now-playing-empty">{error}</div>
        ) : model?.kind === 'video' && model.mediaUrl ? (
          <VideoPreview
            key={playerKey}
            url={model.mediaUrl}
            posterUrl={model.posterUrl}
            autoplay={resumePlaying}
            active
            startAtSec={handoff.startAtSec}
            startPaused={handoff.paused === true}
            onOpenExternal={() => void api.shell.openPath({ path })}
          />
        ) : useRich && path ? (
          <MpvPreview
            key={playerKey}
            path={path}
            posterUrl={model?.posterUrl ?? model?.stripFrames?.[0]}
            autoplay={resumePlaying}
            active
            startAtSec={handoff.startAtSec}
            onOpenExternal={() => void api.shell.openPath({ path })}
          />
        ) : model?.stripFrames && model.stripFrames.length > 0 ? (
          <VideoStripPreview
            frames={model.stripFrames}
            onOpenExternal={() => void api.shell.openPath({ path })}
            chrome
          />
        ) : (
          <div className="now-playing-empty">
            <p>Cannot play this format in-app.</p>
            <button type="button" className="btn" onClick={() => void api.shell.openPath({ path })}>
              Open with default app
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
