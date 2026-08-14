const DISPLAY_CAP = 1024 * 1024

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function textToHtml(text: string): string {
  return text
    .split(/\r?\n\r?\n/)
    .map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br/>')}</p>`)
    .join('')
}

function capHtml(html: string, warnings: string[]): string {
  if (html.length > DISPLAY_CAP) {
    warnings.push('Document preview truncated')
    return html.slice(0, DISPLAY_CAP) + '<p><em>…</em></p>'
  }
  return html
}

/** .docx → HTML via mammoth (embedded images skipped by default in Node). */
export async function docxToHtml(file: string, warnings: string[]): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.convertToHtml({ path: file })
  for (const m of result.messages) {
    if (m.type === 'warning' && warnings.length < 5) warnings.push(m.message)
  }
  return capHtml(result.value || '<p><em>(empty document)</em></p>', warnings)
}

type WordExtractorCtor = new () => { extract(path: string): Promise<{ getBody(): string }> }

/** .doc (OLE) → HTML via word-extractor plain text. */
export async function docToHtml(file: string, warnings: string[]): Promise<string> {
  const mod: unknown = await import('word-extractor')
  // CJS package: import may be the class itself or `{ default: class }`.
  const WordExtractor = (
    typeof mod === 'function'
      ? mod
      : (mod as { default: WordExtractorCtor }).default
  ) as WordExtractorCtor
  const extractor = new WordExtractor()
  const doc = await extractor.extract(file)
  const body = doc.getBody()?.trim() ?? ''
  if (!body) {
    warnings.push('No extractable text in Word document')
    return '<p><em>(empty document)</em></p>'
  }
  return capHtml(textToHtml(body), warnings)
}
