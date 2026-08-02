import { useMemo, type JSX } from 'react'
import { highlightCode } from '../../lib/highlight'

/** Syntax-highlighted text preview (highlight.js + theme CSS variables). */
export function CodePreview({ source, path }: { source: string; path: string }): JSX.Element {
  const { html, language } = useMemo(() => highlightCode(source, path), [source, path])

  return (
    <pre
      className="preview-text preview-code"
      data-language={language ?? 'text'}
      tabIndex={0}
    >
      <code className={language ? `language-${language}` : undefined} dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}
