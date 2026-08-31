import { useMemo, type JSX } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: false })

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style']
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Rendered GitHub release body for Settings → About → Updates. */
export function ReleaseNotesBody({ markdown }: { markdown: string }): JSX.Element {
  const html = useMemo(() => {
    const source = markdown.trim()
    if (!source) {
      return sanitizeHtml('<p><em>No release notes were published for this version.</em></p>')
    }
    try {
      const raw = marked.parse(source, { async: false }) as string
      return sanitizeHtml(raw)
    } catch {
      return sanitizeHtml(`<pre>${escapeHtml(source)}</pre>`)
    }
  }, [markdown])

  return (
    <div
      className="preview-rich md settings-release-notes-md"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
