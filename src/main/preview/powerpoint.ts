import fsp from 'node:fs/promises'
import JSZip from 'jszip'

const DISPLAY_CAP = 200 * 1024

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

function capHtml(html: string, warnings: string[]): string {
  if (html.length > DISPLAY_CAP) {
    warnings.push('Presentation preview truncated')
    return html.slice(0, DISPLAY_CAP) + '<p><em>…</em></p>'
  }
  return html
}

function slideIndex(name: string): number {
  const m = /slide(\d+)\.xml$/i.exec(name)
  return m ? Number(m[1]) : 0
}

/** Extract paragraph text runs from a PPTX slide XML part. */
export function extractPptxSlideParagraphs(xml: string): string[] {
  const paras: string[] = []
  // Split on paragraph closes; also handle drawingML `a:p` without relying on a full XML parser.
  const chunks = xml.split(/<\/a:p>/i)
  for (const chunk of chunks) {
    const runs: string[] = []
    const re = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(chunk))) {
      const t = decodeXmlEntities(m[1] ?? '')
      if (t.trim().length > 0) runs.push(t)
    }
    if (runs.length > 0) paras.push(runs.join('').replace(/\s+/g, ' ').trim())
  }
  return paras
}

function textToHtml(text: string): string {
  return text
    .split(/\r?\n\r?\n/)
    .map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br/>')}</p>`)
    .join('')
}

/**
 * Best-effort text scrape from legacy binary `.ppt` (OLE).
 * Not a layout renderer — pulls readable UTF-16LE / ASCII runs.
 */
export function extractPptBinaryTexts(buf: Buffer): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const MAX = 8 * 1024 * 1024
  const data = buf.length > MAX ? buf.subarray(0, MAX) : buf

  // UTF-16LE runs of printable chars (length >= 4 code units)
  for (let i = 0; i + 3 < data.length; i += 2) {
    let j = i
    const chars: string[] = []
    while (j + 1 < data.length) {
      const code = data[j]! | (data[j + 1]! << 8)
      if (code === 0) break
      const ok =
        code === 0x09 ||
        code === 0x0a ||
        code === 0x0d ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd)
      if (!ok) break
      chars.push(String.fromCharCode(code))
      j += 2
      if (chars.length > 400) break
    }
    if (chars.length >= 4) {
      const s = chars.join('').replace(/\s+/g, ' ').trim()
      if (s.length >= 4 && !seen.has(s) && !looksLikeBinaryJunk(s)) {
        seen.add(s)
        out.push(s)
        if (out.length >= 80) break
      }
      i = j
    }
  }

  return out
}

function looksLikeBinaryJunk(s: string): boolean {
  if (/^[\d\s.]+$/.test(s)) return true
  if (/^[A-Z]{1,3}\d+$/.test(s)) return true
  const letters = (s.match(/\p{L}/gu) ?? []).length
  return letters < Math.min(4, Math.floor(s.length * 0.4))
}

/** `.pptx` → HTML (text per slide). Images/charts omitted. */
export async function pptxToHtml(file: string, warnings: string[]): Promise<string> {
  const buf = await fsp.readFile(file)
  const zip = await JSZip.loadAsync(buf)
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => slideIndex(a) - slideIndex(b))

  if (slideNames.length === 0) {
    warnings.push('No slides found in presentation')
    return '<p><em>(empty presentation)</em></p>'
  }

  const parts: string[] = []
  for (let i = 0; i < slideNames.length; i++) {
    const entry = zip.file(slideNames[i]!)
    if (!entry) continue
    const xml = await entry.async('string')
    const paras = extractPptxSlideParagraphs(xml)
    const body =
      paras.length > 0
        ? paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('')
        : '<p class="ppt-empty"><em>(no text on this slide)</em></p>'
    parts.push(
      `<section class="ppt-slide"><h3 class="ppt-slide-title">Slide ${i + 1}</h3>${body}</section>`
    )
  }

  warnings.push('PowerPoint preview shows slide text only (not full layout)')
  return capHtml(parts.join('\n'), warnings)
}

/** Legacy `.ppt` → HTML via best-effort binary text scrape. */
export async function pptToHtml(file: string, warnings: string[]): Promise<string> {
  const buf = await fsp.readFile(file)
  const texts = extractPptBinaryTexts(buf)
  if (texts.length === 0) {
    warnings.push('Could not extract text from legacy .ppt')
    return '<p><em>No text preview for this .ppt file. Use Open with default app for a full view.</em></p>'
  }
  warnings.push('Legacy .ppt preview is text-only and may be incomplete')
  return capHtml(textToHtml(texts.join('\n\n')), warnings)
}
