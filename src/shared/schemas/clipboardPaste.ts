import { z } from 'zod'

export const clipboardPasteFormatSchema = z.enum(['png', 'jpeg', 'webp', 'txt', 'html', 'url'])
export type ClipboardPasteFormat = z.infer<typeof clipboardPasteFormatSchema>

export const clipboardPeekKindSchema = z.enum(['files', 'image', 'url', 'html', 'text', 'empty'])
export type ClipboardPeekKind = z.infer<typeof clipboardPeekKindSchema>

export const clipboardPeekSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('files') }),
  z.object({ kind: z.literal('image') }),
  z.object({ kind: z.literal('url'), url: z.string().min(1).max(4096) }),
  z.object({ kind: z.literal('html') }),
  z.object({ kind: z.literal('text') }),
  z.object({ kind: z.literal('empty') })
])
export type ClipboardPeek = z.infer<typeof clipboardPeekSchema>

export const clipboardWriteFileRequestSchema = z.object({
  destDir: z.string().min(1),
  format: clipboardPasteFormatSchema,
  /** Optional basename including extension. Unique-named if taken. */
  name: z.string().min(1).max(240).optional()
})
export type ClipboardWriteFileRequest = z.infer<typeof clipboardWriteFileRequestSchema>

export function isSingleHttpUrl(text: string): boolean {
  const t = text.trim()
  if (!t || /\s/.test(t)) return false
  try {
    const u = new URL(t)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function htmlLooksRich(html: string, text: string): boolean {
  const h = html.trim()
  if (!h) return false
  if (/<(img|table|video|svg|style|picture)\b/i.test(h)) return true
  if (/mso-|xmlns:/i.test(h)) return true
  const stripped = h
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const t = text.replace(/\s+/g, ' ').trim()
  if (t && stripped === t) return false
  return h.length > text.length + 80
}

export function classifyClipboard(input: {
  hasFiles: boolean
  hasImage: boolean
  text: string
  html: string
}): ClipboardPeekKind {
  if (input.hasFiles) return 'files'
  if (input.hasImage) return 'image'
  if (isSingleHttpUrl(input.text)) return 'url'
  if (htmlLooksRich(input.html, input.text)) return 'html'
  if (input.text.trim()) return 'text'
  if (input.html.trim()) return 'html'
  return 'empty'
}

export function defaultPasteFormat(kind: ClipboardPeekKind): ClipboardPasteFormat | null {
  switch (kind) {
    case 'image':
      return 'png'
    case 'url':
      return 'url'
    case 'html':
      return 'html'
    case 'text':
      return 'txt'
    default:
      return null
  }
}

export function sanitizeFileStem(raw: string, fallback = 'Clipboard'): string {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex -- strip Windows-forbidden + C0 controls
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 0 ? cleaned.slice(0, 180) : fallback
}
