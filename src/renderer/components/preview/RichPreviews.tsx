import { useEffect, useMemo, useState, type JSX } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { SpreadsheetSheet } from '@shared/schemas/preview'
import { pdfPreviewSrc } from '../../lib/pdfPreview'

marked.setOptions({ gfm: true, breaks: false })

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style']
  })
}

export function MarkdownPreview({ source }: { source: string }): JSX.Element {
  const html = useMemo(() => {
    try {
      const raw = marked.parse(source, { async: false }) as string
      return sanitizeHtml(raw)
    } catch {
      return sanitizeHtml(`<pre>${escapeHtml(source)}</pre>`)
    }
  }, [source])
  return <div className="preview-rich md" dangerouslySetInnerHTML={{ __html: html }} />
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

export function VideoPreview({
  url,
  onOpenExternal
}: {
  url: string
  onOpenExternal(): void
}): JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [url])
  if (failed) {
    return (
      <div className="preview-av-fallback">
        <p>This video can’t play in the built-in player (codec or container not supported).</p>
        <button type="button" className="btn" onClick={onOpenExternal}>
          Open with default app
        </button>
      </div>
    )
  }
  return (
    <div className="preview-media preview-av">
      <video
        key={url}
        className="preview-video"
        src={url}
        controls
        preload="metadata"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

export function AudioPreview({
  url,
  onOpenExternal
}: {
  url: string
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
      <audio
        key={url}
        className="preview-audio"
        src={url}
        controls
        preload="metadata"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
