/** RFC 5322 / MIME `.eml` — headers, multipart, QP / base64 text. Not Outlook `.msg`. */

export const EML_BODY_MAX_CHARS = 200_000
export const EML_ATTACH_MAX = 40

export type EmlAttachment = {
  filename: string
  mime: string
  size?: number
}

export type EmlMessage = {
  from?: string
  to?: string
  cc?: string
  bcc?: string
  replyTo?: string
  subject?: string
  date?: string
  text?: string
  html?: string
  attachments: EmlAttachment[]
}

type MimePart = {
  headers: Record<string, string>
  body: string
}

function normalizeNl(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function looksLikeEml(text: string): boolean {
  const head = text.slice(0, 8192)
  return /^(From|Subject|Date|To|MIME-Version|Return-Path|Received|Message-ID):/im.test(head)
}

function unfoldHeaders(block: string): string[] {
  const raw = normalizeNl(block).split('\n')
  const lines: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += ' ' + line.trim()
    } else {
      lines.push(line)
    }
  }
  return lines
}

function parseHeaderBlock(block: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of unfoldHeaders(block)) {
    const m = /^([A-Za-z0-9-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1]!.toLowerCase()
    if (headers[key] == null) headers[key] = m[2]!.trim()
  }
  return headers
}

function headerParam(value: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|[^;\\s]+)`, 'i')
  const m = re.exec(value)
  if (!m) return undefined
  let v = m[1]!.trim()
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"')
  return v
}

function headerType(value: string | undefined): string {
  if (!value) return 'text/plain'
  return (value.split(';')[0] ?? 'text/plain').trim().toLowerCase()
}

function normalizeCharset(cs: string): string {
  const c = cs.trim().toLowerCase().replace(/_/g, '-')
  if (c === 'utf8' || c === 'utf-8') return 'utf-8'
  if (c === 'iso-8859-1' || c === 'latin1' || c === 'latin-1') return 'iso-8859-1'
  if (c === 'us-ascii' || c === 'ascii') return 'windows-1252'
  if (c === 'windows-1252' || c === 'cp1252') return 'windows-1252'
  return c
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(normalizeCharset(charset), { fatal: false }).decode(bytes)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  }
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '')
  const bin = globalThis.atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function decodeQuotedPrintableBytes(raw: string): Uint8Array {
  const soft = raw.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === '=' && /^[0-9A-Fa-f]{2}/.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      bytes.push(soft.charCodeAt(i) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

export function decodeQuotedPrintable(raw: string, charset = 'utf-8'): string {
  return decodeBytes(decodeQuotedPrintableBytes(raw), charset)
}

export function decodeEncodedWords(input: string): string {
  return input.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=\s*/g, (_all, charset: string, enc: string, data: string) => {
    try {
      if (enc.toUpperCase() === 'B') {
        return decodeBytes(decodeBase64(data), charset)
      }
      return decodeBytes(decodeQuotedPrintableBytes(data.replace(/_/g, ' ')), charset)
    } catch {
      return data
    }
  }).trimEnd()
}

function decodeRfc2231(value: string): string {
  const m = /^([^']*)'[^']*'(.*)$/.exec(value)
  if (!m) return decodeEncodedWords(value)
  const charset = m[1] || 'utf-8'
  try {
    const pct = m[2]!.replace(/\+/g, ' ')
    const bytes = new Uint8Array(pct.length)
    let n = 0
    for (let i = 0; i < pct.length; i++) {
      if (pct[i] === '%' && /^[0-9A-Fa-f]{2}/.test(pct.slice(i + 1, i + 3))) {
        bytes[n++] = parseInt(pct.slice(i + 1, i + 3), 16)
        i += 2
      } else {
        bytes[n++] = pct.charCodeAt(i) & 0xff
      }
    }
    return decodeBytes(bytes.subarray(0, n), charset)
  } catch {
    return value
  }
}

function decodeBody(raw: string, headers: Record<string, string>): string {
  const cte = (headers['content-transfer-encoding'] ?? '7bit').toLowerCase()
  const charset = headerParam(headers['content-type'] ?? '', 'charset') ?? 'utf-8'
  if (cte === 'base64') return decodeBytes(decodeBase64(raw), charset)
  if (cte === 'quoted-printable') return decodeQuotedPrintable(raw, charset)
  return raw.replace(/^\n/, '')
}

function splitMultipart(body: string, boundary: string): string[] {
  const norm = normalizeNl(body)
  const delim = `--${boundary}`
  const end = `--${boundary}--`
  const parts: string[] = []
  let from = norm.indexOf(delim)
  if (from < 0) return []
  while (from >= 0) {
    if (norm.startsWith(end, from)) break
    const start = from + delim.length
    const next = norm.indexOf('\n--' + boundary, start)
    const chunk = next < 0 ? norm.slice(start) : norm.slice(start, next)
    const trimmed = chunk.replace(/^\n/, '').replace(/\n$/, '')
    if (trimmed && !trimmed.startsWith('--')) parts.push(trimmed)
    if (next < 0) break
    from = next + 1
  }
  return parts
}

function parsePart(raw: string): MimePart {
  const norm = normalizeNl(raw)
  const split = norm.match(/\n\n/)
  if (!split || split.index == null) {
    return { headers: parseHeaderBlock(norm), body: '' }
  }
  return {
    headers: parseHeaderBlock(norm.slice(0, split.index)),
    body: norm.slice(split.index + split[0].length)
  }
}

function partFilename(headers: Record<string, string>): string | undefined {
  const disp = headers['content-disposition'] ?? ''
  const star = headerParam(disp, 'filename*')
  if (star) return decodeRfc2231(star)
  const fn = headerParam(disp, 'filename') ?? headerParam(headers['content-type'] ?? '', 'name')
  return fn ? decodeEncodedWords(fn) : undefined
}

function isAttachment(headers: Record<string, string>): boolean {
  const disp = (headers['content-disposition'] ?? '').toLowerCase()
  if (disp.startsWith('attachment')) return true
  const mime = headerType(headers['content-type'])
  if (mime.startsWith('text/') || mime.startsWith('multipart/') || mime === 'message/rfc822') {
    return false
  }
  return !!partFilename(headers) || disp.includes('filename')
}

function approxSize(headers: Record<string, string>, body: string): number | undefined {
  const cte = (headers['content-transfer-encoding'] ?? '').toLowerCase()
  const n = body.replace(/\s+/g, '').length
  if (!n) return undefined
  if (cte === 'base64') return Math.floor((n * 3) / 4)
  return n
}

function walkPart(
  part: MimePart,
  out: { text?: string; html?: string; attachments: EmlAttachment[] }
): void {
  const mime = headerType(part.headers['content-type'])
  const boundary = headerParam(part.headers['content-type'] ?? '', 'boundary')

  if (mime.startsWith('multipart/') && boundary) {
    for (const chunk of splitMultipart(part.body, boundary)) {
      walkPart(parsePart(chunk), out)
    }
    return
  }

  if (isAttachment(part.headers) || (!mime.startsWith('text/') && mime !== 'message/rfc822')) {
    if (out.attachments.length >= EML_ATTACH_MAX) return
    const filename = partFilename(part.headers) || defaultAttachName(mime)
    out.attachments.push({
      filename,
      mime,
      size: approxSize(part.headers, part.body)
    })
    return
  }

  if (mime === 'text/html') {
    const html = decodeBody(part.body, part.headers).trim()
    if (html && !out.html) out.html = capBody(html)
    return
  }
  if (mime === 'text/plain' || mime.startsWith('text/')) {
    const text = decodeBody(part.body, part.headers).trim()
    if (text && !out.text) out.text = capBody(text)
  }
}

function defaultAttachName(mime: string): string {
  const sub = mime.split('/')[1] || 'bin'
  return `attachment.${sub.replace(/[^a-z0-9.+-]/gi, '') || 'bin'}`
}

function capBody(s: string): string {
  if (s.length <= EML_BODY_MAX_CHARS) return s
  return `${s.slice(0, EML_BODY_MAX_CHARS)}\n…`
}

function skipMboxFrom(text: string): string {
  const norm = normalizeNl(text)
  if (/^From \S/.test(norm)) {
    const nl = norm.indexOf('\n')
    return nl >= 0 ? norm.slice(nl + 1) : ''
  }
  return norm
}

export function parseEml(text: string): EmlMessage | null {
  if (!looksLikeEml(text)) return null
  const root = parsePart(skipMboxFrom(text))
  const h = root.headers
  const picked: { text?: string; html?: string; attachments: EmlAttachment[] } = {
    attachments: []
  }
  const mime = headerType(h['content-type'])
  if (mime.startsWith('multipart/')) {
    walkPart(root, picked)
  } else if (mime === 'text/html') {
    picked.html = capBody(decodeBody(root.body, h).trim())
  } else {
    picked.text = capBody(decodeBody(root.body, h).trim())
  }

  const subject = h.subject ? decodeEncodedWords(h.subject) : undefined
  const from = h.from ? decodeEncodedWords(h.from) : undefined
  const to = h.to ? decodeEncodedWords(h.to) : undefined
  if (!from && !to && !subject && !picked.text && !picked.html) return null

  return {
    from,
    to,
    cc: h.cc ? decodeEncodedWords(h.cc) : undefined,
    bcc: h.bcc ? decodeEncodedWords(h.bcc) : undefined,
    replyTo: h['reply-to'] ? decodeEncodedWords(h['reply-to']) : undefined,
    subject,
    date: h.date,
    text: picked.text,
    html: picked.html,
    attachments: picked.attachments
  }
}

function bytesHuman(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n >= 100 * 1024 ? 0 : 1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function formatEmlHeaders(msg: EmlMessage): string {
  const lines: string[] = []
  const row = (label: string, value?: string): void => {
    if (value) lines.push(`${label}: ${value}`)
  }
  row('From', msg.from)
  row('To', msg.to)
  row('Cc', msg.cc)
  row('Bcc', msg.bcc)
  row('Reply-To', msg.replyTo)
  row('Date', msg.date)
  row('Subject', msg.subject)
  if (msg.attachments.length) {
    const list = msg.attachments
      .map((a) => (a.size != null ? `${a.filename} (${bytesHuman(a.size)})` : a.filename))
      .join(', ')
    lines.push(`Attachments: ${list}`)
  }
  return lines.join('\n')
}
