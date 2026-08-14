/**
 * Lightweight RTF → plain text / simple HTML for previews.
 * Not a full RTF engine — good enough to show readable document content.
 */

const DISPLAY_CAP = 1024 * 1024

export function rtfToPlainText(rtf: string): string {
  let s = rtf.replace(/\r\n?/g, '\n')

  // Strip common destination groups (font table, color table, pictures, …)
  for (let i = 0; i < 8; i++) {
    const next = s.replace(
      /\{\\(\*|fonttbl|colortbl|stylesheet|info|header|footer|pict|object|xe|tc|listtable|listoverridetable|revtbl)[^]*?\}/gi,
      ''
    )
    if (next === s) break
    s = next
  }

  // Unicode escapes (\uN?)
  s = s.replace(/\\u(-?\d+)\??/g, (_, n) => {
    let code = Number(n)
    if (code < 0) code += 65536
    try {
      return String.fromCodePoint(code)
    } catch {
      return ''
    }
  })
  // Hex bytes \'hh
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  // Paragraph / line breaks
  s = s.replace(/\\par[d]?\b/g, '\n').replace(/\\line\b/g, '\n').replace(/\\tab\b/g, '\t')
  // Remaining control words / symbols
  s = s.replace(/\\[a-z]+-?\d*\s?/gi, '')
  s = s.replace(/\\([{}\\])/g, '$1')
  s = s.replace(/[{}]/g, '')
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return s
}

export function rtfToHtml(rtf: string, warnings: string[]): string {
  let text = rtfToPlainText(rtf)
  if (text.length > DISPLAY_CAP) {
    warnings.push('RTF preview truncated')
    text = text.slice(0, DISPLAY_CAP)
  }
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  if (!escaped) return '<p><em>(empty document)</em></p>'
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('')
}
