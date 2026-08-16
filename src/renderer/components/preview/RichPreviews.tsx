import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { PptSlidePreview, SpreadsheetSheet } from '@shared/schemas/preview'
import { formatIcsAgenda, parseIcs } from '@shared/ics'
import { formatEmlHeaders, parseEml } from '@shared/eml'
import { pdfPreviewSrc } from '../../lib/pdfPreview'
import { DEFAULT_VID_THUMB_FRAME_MS } from '@shared/vidThumbCache'
import { useAppStore } from '../../store/appStore'
import { CodePreview } from './CodePreview'

function releaseHtmlMedia(el: HTMLMediaElement | null): void {
  if (!el) return
  el.pause()
  el.removeAttribute('src')
  el.load()
}

marked.setOptions({ gfm: true, breaks: false })

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style']
  })
}

/** PowerPoint layout preview — allow positioned boxes + mfe-media images. */
function sanitizePptHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['style', 'class'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|mfe-media):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i
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

/** iCalendar — agenda by default, raw `.ics` on toggle. */
export function IcsPreview({
  source,
  path
}: {
  source: string
  path: string
}): JSX.Element {
  const agenda = useMemo(() => {
    const cal = parseIcs(source)
    return cal ? formatIcsAgenda(cal) : null
  }, [source])
  if (!agenda) {
    return <CodePreview source={source} path={path} />
  }
  return (
    <SourceModeShell path={path} source={source}>
      <pre className="preview-text preview-code" tabIndex={0}>
        <code>{agenda}</code>
      </pre>
    </SourceModeShell>
  )
}

function sanitizeEmlHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'img', 'picture', 'video', 'audio', 'source'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
    ALLOWED_URI_REGEXP: /^(?:mailto:|#)/i
  })
}

/** Saved email — headers + body; remote images are not loaded. */
export function EmlPreview({
  source,
  path
}: {
  source: string
  path: string
}): JSX.Element {
  const msg = useMemo(() => parseEml(source), [source])
  const headers = msg ? formatEmlHeaders(msg) : ''
  const html = useMemo(() => (msg?.html ? sanitizeEmlHtml(msg.html) : ''), [msg])
  if (!msg || !headers) {
    return <CodePreview source={source} path={path} />
  }
  return (
    <SourceModeShell path={path} source={source}>
      <div className="preview-eml">
        <pre className="preview-text preview-code" tabIndex={0}>
          <code>{headers}</code>
        </pre>
        {html ? (
          <div className="preview-rich html" dangerouslySetInnerHTML={{ __html: html }} />
        ) : msg.text ? (
          <pre className="preview-text preview-code" tabIndex={0}>
            <code>{msg.text}</code>
          </pre>
        ) : null}
      </div>
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
  const ppt = html.includes('ppt-deck')
  const safe = useMemo(() => (ppt ? sanitizePptHtml(html) : sanitizeHtml(html)), [html, ppt])
  return (
    <div
      className={`preview-rich doc${ppt ? ' ppt' : ''}`}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}

function isDarkHex(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  if (!Number.isFinite(n)) return false
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (r * 299 + g * 587 + b * 114) / 1000 < 140
}

function PptSlideCard({ slide }: { slide: PptSlidePreview }): JSX.Element {
  const hasText = slide.items.some((it) => it.kind === 'text')
  const hasVisual =
    Boolean(slide.bgImageUrl) || slide.items.length > 0 || slide.fallbackLines.length > 0
  const dark = slide.bg ? isDarkHex(slide.bg) : false
  const showInnerFallback = slide.fallbackLines.length > 0 && !hasText
  const showExtraFallback = slide.fallbackLines.length > 0 && hasText

  return (
    <section className="ppt-slide">
      <div className="ppt-slide-label">Slide {slide.index}</div>
      {hasVisual ? (
        <div
          className={`ppt-stage${dark ? ' ppt-stage-dark' : ''}`}
          style={{
            aspectRatio: String(slide.aspect),
            background: slide.bg ?? undefined
          }}
        >
          {slide.bgImageUrl ? (
            <img className="ppt-bg" src={slide.bgImageUrl} alt="" draggable={false} />
          ) : null}
          {slide.items.map((it, i) => {
            const box = {
              left: `${it.box.l}%`,
              top: `${it.box.t}%`,
              width: `${it.box.w}%`,
              height: `${it.box.h}%`
            }
            if (it.kind === 'pic') {
              return (
                <div key={i} className="ppt-abs ppt-pic" style={box}>
                  <img src={it.url} alt="" draggable={false} />
                </div>
              )
            }
            return (
              <div key={i} className={`ppt-abs ${it.title ? 'ppt-title' : 'ppt-body'}`} style={box}>
                {it.lines.map((line, j) => (
                  <p key={j} className={it.title ? 'ppt-t' : undefined}>
                    {line}
                  </p>
                ))}
              </div>
            )
          })}
          {showInnerFallback ? (
            <div className="ppt-fallback">
              {slide.fallbackLines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="ppt-empty">No previewable content on this slide</p>
      )}
      {showExtraFallback ? (
        <div className="ppt-extra">
          {slide.fallbackLines.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </div>
      ) : null}
      {slide.notes.length > 0 ? (
        <div className="ppt-notes">
          <span className="ppt-notes-label">Notes</span>
          {slide.notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </div>
      ) : null}
    </section>
  )
}

export function PowerPointPreview({ slides }: { slides: PptSlidePreview[] }): JSX.Element {
  if (slides.length === 0) {
    return <div className="preview-empty">No slides</div>
  }
  return (
    <div className="preview-rich doc ppt">
      <div className="ppt-deck">
        {slides.map((slide) => (
          <PptSlideCard key={slide.index} slide={slide} />
        ))}
      </div>
    </div>
  )
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
  onOpenExternal,
  chrome = true
}: {
  frames: string[]
  onOpenExternal(): void
  /** False: frames only (Zen mode). */
  chrome?: boolean
}): JSX.Element {
  const frameMs = useAppStore((s) => s.settings?.vidThumbFrameMs) ?? DEFAULT_VID_THUMB_FRAME_MS
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
      {chrome ? (
        <>
          <p>Open with the default app to play this video.</p>
          <button type="button" className="btn" onClick={onOpenExternal}>
            Open with default app
          </button>
        </>
      ) : null}
    </div>
  )
}

export function VideoPreview({
  url,
  posterUrl,
  preparing,
  autoplay,
  active = true,
  onOpenExternal,
  onAudioOnly
}: {
  url?: string
  posterUrl?: string
  /** Remux/transcode in progress. */
  preparing?: boolean
  autoplay?: boolean
  /** False: poster only (pop-out owns the live player). */
  active?: boolean
  onOpenExternal(): void
  /** Chromium decoded audio but no video — bad remux; request force transcode. */
  onAudioOnly?(): void
}): JSX.Element | null {
  const [failed, setFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    setFailed(false)
    const el = videoRef.current
    return () => releaseHtmlMedia(el)
  }, [url, posterUrl, active])

  if (!active) {
    if (!posterUrl) return null
    return (
      <div className="preview-av-fallback preview-av-poster">
        <img className="preview-video-poster" src={posterUrl} alt="" draggable={false} />
      </div>
    )
  }

  if (url && !failed) {
    return (
      <div className="preview-media preview-av">
        <video
          key={url}
          ref={videoRef}
          className="preview-video"
          src={url}
          poster={posterUrl}
          controls
          playsInline
          disablePictureInPicture
          controlsList="nofullscreen nodownload noremoteplayback"
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
  active = true,
  onOpenExternal
}: {
  url: string
  coverUrl?: string
  autoplay?: boolean
  /** False: cover only (pop-out owns the live player). */
  active?: boolean
  onOpenExternal(): void
}): JSX.Element | null {
  const [failed, setFailed] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    setFailed(false)
    const el = audioRef.current
    return () => releaseHtmlMedia(el)
  }, [url, active])
  if (!active) {
    if (!coverUrl) return null
    return (
      <div className="preview-media preview-av preview-av-audio">
        <div className="preview-audio-cover">
          <img src={coverUrl} alt="" draggable={false} />
        </div>
      </div>
    )
  }
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
        ref={audioRef}
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
