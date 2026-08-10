import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { SpreadsheetSheet } from '@shared/schemas/preview'
import { pdfPreviewSrc } from '../../lib/pdfPreview'
import { useAppStore } from '../../store/appStore'
import { CodePreview } from './CodePreview'

marked.setOptions({ gfm: true, breaks: false })

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style']
  })
}

type SourceMode = 'preview' | 'raw'

/** Preview / Raw toggle for markdown & HTML source files. Defaults to rendered. */
function SourceModeShell({
  path,
  source,
  children
}: {
  path: string
  source: string
  children: ReactNode
}): JSX.Element {
  const [mode, setMode] = useState<SourceMode>('preview')
  useEffect(() => {
    setMode('preview')
  }, [path, source])

  return (
    <div className="preview-source">
      <div className="preview-source-toggle" role="tablist" aria-label="Preview mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'preview'}
          className={`preview-source-tab${mode === 'preview' ? ' active' : ''}`}
          onClick={() => setMode('preview')}
        >
          Preview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'raw'}
          className={`preview-source-tab${mode === 'raw' ? ' active' : ''}`}
          onClick={() => setMode('raw')}
        >
          Raw
        </button>
      </div>
      <div className="preview-source-body">
        {mode === 'preview' ? children : <CodePreview source={source} path={path} />}
      </div>
    </div>
  )
}

export function MarkdownPreview({
  source,
  path
}: {
  source: string
  path: string
}): JSX.Element {
  const html = useMemo(() => {
    try {
      const raw = marked.parse(source, { async: false }) as string
      return sanitizeHtml(raw)
    } catch {
      return sanitizeHtml(`<pre>${escapeHtml(source)}</pre>`)
    }
  }, [source])
  return (
    <SourceModeShell path={path} source={source}>
      <div className="preview-rich md" dangerouslySetInnerHTML={{ __html: html }} />
    </SourceModeShell>
  )
}

/** Standalone `.html` / `.htm` — sanitized render + raw source toggle. */
export function HtmlSourcePreview({
  source,
  path
}: {
  source: string
  path: string
}): JSX.Element {
  const safe = useMemo(() => sanitizeHtml(source), [source])
  return (
    <SourceModeShell path={path} source={source}>
      <div className="preview-rich html" dangerouslySetInnerHTML={{ __html: safe }} />
    </SourceModeShell>
  )
}

export function HtmlDocumentPreview({ html }: { html: string }): JSX.Element {
  const safe = useMemo(() => sanitizeHtml(html), [html])
  return <div className="preview-rich doc" dangerouslySetInnerHTML={{ __html: safe }} />
}

export function PdfPreview({ url }: { url: string }): JSX.Element {
  return <iframe className="preview-pdf" src={pdfPreviewSrc(url)} title="PDF preview" />
}

export function SpreadsheetPreview({ sheets }: { sheets: SpreadsheetSheet[] }): JSX.Element {
  const [idx, setIdx] = useState(0)
  const sheet = sheets[Math.min(idx, Math.max(0, sheets.length - 1))]
  if (!sheet || sheets.length === 0) {
    return <div className="preview-empty">Empty spreadsheet</div>
  }
  const colCount = Math.max(1, ...sheet.rows.map((r) => r.length))
  return (
    <div className="preview-sheet">
      {sheets.length > 1 && (
        <div className="sheet-tabs" role="tablist">
          {sheets.map((s, i) => (
            <button
              key={s.name + i}
              role="tab"
              aria-selected={i === idx}
              className={`sheet-tab${i === idx ? ' active' : ''}`}
              onClick={() => setIdx(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="sheet-scroll">
        <table className="sheet-table">
          <tbody>
            {sheet.rows.length === 0 ? (
              <tr>
                <td className="dim">Empty sheet</td>
              </tr>
            ) : (
              sheet.rows.map((row, ri) => (
                <tr key={ri}>
                  <th className="sheet-rownum">{ri + 1}</th>
                  {Array.from({ length: colCount }, (_, ci) => (
                    <td key={ci}>{row[ci] ?? ''}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Animated `!VIDTHUMB_CACHE` strip + Open (used for `.avi` — no in-pane player). */
export function VideoStripPreview({
  frames,
  onOpenExternal
}: {
  frames: string[]
  onOpenExternal(): void
}): JSX.Element {
  const frameMs = useAppStore((s) => s.settings.vidThumbFrameMs)
  const [src, setSrc] = useState(frames[0] ?? '')
  const idxRef = useRef(0)
  const decoded = useRef(new Set<string>())

  useEffect(() => {
    idxRef.current = 0
    setSrc(frames[0] ?? '')
    decoded.current.clear()
    for (const url of frames) {
      const img = new Image()
      img.onload = () => {
        decoded.current.add(url)
      }
      img.src = url
    }
  }, [frames])

  useEffect(() => {
    if (frames.length < 2) return
    const id = window.setInterval(() => {
      const next = (idxRef.current + 1) % frames.length
      const url = frames[next]
      if (!url || !decoded.current.has(url)) return
      idxRef.current = next
      setSrc(url)
    }, frameMs)
    return () => window.clearInterval(id)
  }, [frames, frameMs])

  return (
    <div className="preview-av-fallback preview-av-poster">
      {src ? (
        <img className="preview-video-poster" src={src} alt="" draggable={false} />
      ) : null}
      <p>Open with the default app to play this video.</p>
      <button type="button" className="btn" onClick={onOpenExternal}>
        Open with default app
      </button>
    </div>
  )
}

export function VideoPreview({
  url,
  posterUrl,
  preparing,
  autoplay,
  onOpenExternal,
  onAudioOnly
}: {
  url?: string
  posterUrl?: string
  /** Remux/transcode in progress. */
  preparing?: boolean
  autoplay?: boolean
  onOpenExternal(): void
  /** Chromium decoded audio but no video — bad remux; request force transcode. */
  onAudioOnly?(): void
}): JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [url, posterUrl])

  if (url && !failed) {
    return (
      <div className="preview-media preview-av">
        <video
          key={url}
          className="preview-video"
          src={url}
          poster={posterUrl}
          controls
          preload="auto"
          autoPlay={Boolean(autoplay)}
          onError={() => setFailed(true)}
          onLoadedMetadata={(e) => {
            // Same <video> as MP4/MKV — Chromium uses audio-style controls when
            // videoWidth===0. Hide that chrome and ask main to force-transcode.
            if (e.currentTarget.videoWidth === 0) {
              setFailed(true)
              onAudioOnly?.()
            }
          }}
        />
      </div>
    )
  }

  if (posterUrl) {
    return (
      <div className="preview-av-fallback preview-av-poster">
        <img className="preview-video-poster" src={posterUrl} alt="" draggable={false} />
        <p>
          {preparing
            ? 'Preparing a short in-app preview…'
            : failed
              ? 'This video can’t play in the built-in player (codec not supported).'
              : 'Could not prepare in-app playback for this file.'}
        </p>
        <button type="button" className="btn" onClick={onOpenExternal}>
          Open with default app
        </button>
      </div>
    )
  }

  return (
    <div className="preview-av-fallback">
      <p>
        {preparing
          ? 'Preparing a short in-app preview…'
          : 'This video can’t play in the built-in player (codec or container not supported).'}
      </p>
      <button type="button" className="btn" onClick={onOpenExternal}>
        Open with default app
      </button>
    </div>
  )
}

export function AudioPreview({
  url,
  coverUrl,
  autoplay,
  onOpenExternal
}: {
  url: string
  coverUrl?: string
  autoplay?: boolean
  onOpenExternal(): void
}): JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [url])
  if (failed) {
    return (
      <div className="preview-av-fallback">
        <p>This audio can’t play in the built-in player.</p>
        <button type="button" className="btn" onClick={onOpenExternal}>
          Open with default app
        </button>
      </div>
    )
  }
  return (
    <div className="preview-media preview-av preview-av-audio">
      {coverUrl ? (
        <div className="preview-audio-cover">
          <img src={coverUrl} alt="" draggable={false} />
        </div>
      ) : null}
      <audio
        key={url}
        className="preview-audio"
        src={url}
        controls
        preload="metadata"
        autoPlay={Boolean(autoplay)}
        onError={() => setFailed(true)}
      />
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
