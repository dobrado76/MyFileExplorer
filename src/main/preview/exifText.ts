/**
 * Pull candidate A1111-style parameter strings from JPEG/WebP EXIF and COM markers.
 * ComfyUI image-savers typically store them in UserComment (and Windows shows that as Comments).
 */
import zlib from 'node:zlib'

const JPEG_COM_MAX_PAYLOAD = 65533 // marker length field includes 2 length bytes

/** JPEG COM (0xFFFE) comment segments. */
export function extractJpegComComments(buf: Buffer): string[] {
  const out: string[] = []
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return out
  let i = 2
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    // Skip fill bytes
    while (i < buf.length && buf[i] === 0xff) i++
    if (i >= buf.length) break
    const marker = buf[i++]!
    // Standalone markers without length
    if (marker === 0xd9 /* EOI */ || marker === 0xda /* SOS */) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (i + 2 > buf.length) break
    const len = buf.readUInt16BE(i)
    if (len < 2 || i + len > buf.length) break
    if (marker === 0xfe) {
      const payload = buf.subarray(i + 2, i + len)
      const text = decodeLatin1OrUtf8(payload).replace(/\0+$/g, '').trim()
      if (text) out.push(text)
    }
    i += len
  }
  return out
}

const XMP_NAMESPACE = 'http://ns.adobe.com/xap/1.0/'
const XMP_EXT_PREFIX = 'http://ns.adobe.com/xmp/extension/'
const MAX_INFLATED = 8_000_000

/**
 * Text stored in JPEG segments before the image scan: COM, EXIF, and XMP.
 * Sharp's `metadata().exif` can omit a large UserComment, so generation
 * parsing reads the segments itself. ComfyUI puts the prompt/workflow JSON
 * in one of these even when the A1111 comment only has a node link.
 */
export function extractJpegSegmentTexts(buf: Buffer): string[] {
  const out: string[] = []
  const comTexts: string[] = []
  const extParts: { guid: string; total: number; offset: number; data: Buffer }[] = []
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return out
  let i = 2
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    while (i < buf.length && buf[i] === 0xff) i++
    if (i >= buf.length) break
    const marker = buf[i++]!
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (i + 2 > buf.length) break
    const len = buf.readUInt16BE(i)
    if (len < 2 || i + len > buf.length) break
    const payload = buf.subarray(i + 2, i + len)
    if (marker === 0xfe) {
      const text = decodeSegmentPayload(payload)
      if (text) {
        out.push(text)
        comTexts.push(text)
      }
    } else if (marker === 0xe1 && payload.length > 6) {
      const header = payload.subarray(0, 80).toString('latin1')
      if (header.startsWith('Exif\0\0')) {
        for (const text of extractExifTextCandidates(payload, { graphs: true })) out.push(text)
      } else if (header.startsWith(XMP_NAMESPACE)) {
        const nul = payload.indexOf(0)
        const xml = payload.subarray(nul >= 0 ? nul + 1 : XMP_NAMESPACE.length).toString('utf8')
        const text = unescapeXml(xml).trim()
        if (text) out.push(text)
      } else if (header.startsWith(XMP_EXT_PREFIX)) {
        const part = readXmpExtension(payload)
        if (part) extParts.push(part)
      } else {
        const text = decodeSegmentPayload(payload)
        if (text && looksLikeEmbeddedGraph(text)) out.push(text)
      }
    } else {
      const inflated = inflateIfCompressed(payload)
      if (inflated) out.push(inflated)
    }
    i += len
  }
  if (comTexts.length > 1) {
    const joined = comTexts.join('')
    if (!out.includes(joined)) out.push(joined)
  }
  for (const text of reassembleExtendedXmp(extParts)) {
    if (!out.includes(text)) out.push(text)
  }
  const trailing = textAfterEoi(buf)
  if (trailing && !out.includes(trailing)) out.push(trailing)
  for (const text of embeddedGraphWindows(buf)) {
    if (!out.includes(text)) out.push(text)
  }
  return out
}

const GRAPH_BYTE_NEEDLES = ['widgets_values', 'class_type', 'widgetsValues', 'classType']

/** A window of the file around a Comfy graph key, whatever marker it was stored in. */
function embeddedGraphWindows(buf: Buffer): string[] {
  const out: string[] = []
  for (const needle of GRAPH_BYTE_NEEDLES) {
    const at = buf.indexOf(needle)
    if (at < 0) continue
    out.push(windowText(buf, at))
    break
  }
  const escapedAt = buf.indexOf('&quot;widgets_values')
  const escapedAt2 = buf.indexOf('&quot;class_type')
  const escaped = escapedAt < 0 ? escapedAt2 : escapedAt2 < 0 ? escapedAt : Math.min(escapedAt, escapedAt2)
  if (escaped >= 0) out.push(unescapeXml(windowText(buf, escaped)))
  const utf16 = Buffer.from('class_type', 'utf16le')
  const at16 = buf.indexOf(utf16)
  if (at16 >= 0) {
    let from = Math.max(0, at16 - 3_000_000)
    if (from % 2 !== at16 % 2) from++
    const to = Math.min(buf.length, at16 + 3_000_000)
    out.push(buf.subarray(from, to).toString('utf16le'))
  }
  return out
}

function windowText(buf: Buffer, at: number): string {
  const start = Math.max(0, at - 3_000_000)
  const end = Math.min(buf.length, at + 3_000_000)
  return buf.subarray(start, end).toString('latin1')
}

function readXmpExtension(payload: Buffer): { guid: string; total: number; offset: number; data: Buffer } | null {
  const nul = payload.indexOf(0)
  const base = nul >= 0 ? nul + 1 : XMP_EXT_PREFIX.length
  if (payload.length < base + 40) return null
  const guid = payload.subarray(base, base + 32).toString('ascii')
  const total = payload.readUInt32BE(base + 32)
  const offset = payload.readUInt32BE(base + 36)
  const data = payload.subarray(base + 40)
  if (!guid || data.length === 0 || total > MAX_INFLATED) return null
  return { guid, total, offset, data }
}

function reassembleExtendedXmp(
  parts: { guid: string; total: number; offset: number; data: Buffer }[]
): string[] {
  const byGuid = new Map<string, { total: number; parts: { offset: number; data: Buffer }[] }>()
  for (const part of parts) {
    let group = byGuid.get(part.guid)
    if (!group) {
      group = { total: part.total, parts: [] }
      byGuid.set(part.guid, group)
    }
    group.parts.push({ offset: part.offset, data: part.data })
  }
  const out: string[] = []
  for (const group of byGuid.values()) {
    if (group.total <= 0 || group.total > MAX_INFLATED) continue
    const buf = Buffer.alloc(group.total)
    for (const part of group.parts) {
      if (part.offset >= group.total) continue
      part.data.copy(buf, part.offset, 0, Math.min(part.data.length, group.total - part.offset))
    }
    const text = unescapeXml(buf.toString('utf8')).replace(/\0+$/g, '').trim()
    if (text) out.push(text)
  }
  return out
}

function textAfterEoi(buf: Buffer): string | null {
  for (let i = buf.length - 2; i >= 2; i--) {
    if (buf[i] !== 0xff || buf[i + 1] !== 0xd9) continue
    const rest = buf.subarray(i + 2)
    if (rest.length < 16) return null
    const text = decodeSegmentPayload(rest)
    return text && looksLikeEmbeddedGraph(text) ? text : null
  }
  return null
}

function decodeSegmentPayload(payload: Buffer): string {
  const inflated = inflateIfCompressed(payload)
  if (inflated) return inflated
  if (payload.length >= 2 && payload[0] === 0xff && payload[1] === 0xfe) {
    return payload.subarray(2).toString('utf16le').replace(/\0+$/g, '').trim()
  }
  if (payload.length >= 8 && payload[1] === 0 && payload[3] === 0 && payload[0] !== 0) {
    const as16 = payload.toString('utf16le').replace(/\0+$/g, '').trim()
    if (looksLikeEmbeddedGraph(as16) || as16.includes('Steps:')) return as16
  }
  const text = decodeLatin1OrUtf8(payload).replace(/\0+$/g, '').trim()
  const decoded = decodeBase64Compressed(text)
  return decoded ?? text
}

function looksLikeEmbeddedGraph(text: string): boolean {
  return text.includes('class_type') || text.includes('widgets_values')
}

function inflateIfCompressed(payload: Buffer): string | null {
  if (payload.length < 2 || payload.length > MAX_INFLATED) return null
  const zlibMagic = payload[0] === 0x78 && (payload[1] === 0x01 || payload[1] === 0x5e || payload[1] === 0x9c || payload[1] === 0xda)
  const gzipMagic = payload[0] === 0x1f && payload[1] === 0x8b
  if (!zlibMagic && !gzipMagic) return null
  try {
    const out = gzipMagic ? zlib.gunzipSync(payload) : zlib.inflateSync(payload)
    if (out.length > MAX_INFLATED) return null
    const text = out.toString('utf8').trim()
    if (!looksLikeEmbeddedGraph(text) && !text.includes('Steps:')) return null
    return text
  } catch {
    return null
  }
}

function decodeBase64Compressed(text: string): string | null {
  const compact = text.replace(/\s+/g, '')
  if (compact.length < 64 || compact.length % 4 !== 0) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null
  try {
    return inflateIfCompressed(Buffer.from(compact, 'base64'))
  } catch {
    return null
  }
}

function unescapeXml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function codePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return ''
  return String.fromCodePoint(n)
}

function encodeJpegComPayload(text: string): Buffer {
  // Prefer UTF-8; fall back to latin1 if somehow needed for length (always utf8 for gen text).
  return Buffer.from(text, 'utf8')
}

function buildJpegComSegment(payload: Buffer): Buffer {
  const len = 2 + payload.length
  const seg = Buffer.alloc(2 + len)
  seg[0] = 0xff
  seg[1] = 0xfe
  seg.writeUInt16BE(len, 2)
  payload.copy(seg, 4)
  return seg
}

/**
 * Insert JPEG COM segments immediately after SOI (FF D8).
 * Splits oversized comments across multiple COM markers.
 * Does not remove existing COM — callers usually re-encode first (no COM left).
 */
export function insertJpegComComments(jpegBuf: Buffer, comments: readonly string[]): Buffer {
  const texts = comments.map((c) => c.trim()).filter(Boolean)
  if (texts.length === 0) return jpegBuf
  if (jpegBuf.length < 2 || jpegBuf[0] !== 0xff || jpegBuf[1] !== 0xd8) return jpegBuf

  const segments: Buffer[] = []
  for (const text of texts) {
    let payload = encodeJpegComPayload(text)
    while (payload.length > 0) {
      const chunk = payload.subarray(0, Math.min(payload.length, JPEG_COM_MAX_PAYLOAD))
      segments.push(buildJpegComSegment(chunk))
      payload = payload.subarray(chunk.length)
    }
  }
  if (segments.length === 0) return jpegBuf
  return Buffer.concat([jpegBuf.subarray(0, 2), ...segments, jpegBuf.subarray(2)])
}

function decodeLatin1OrUtf8(buf: Buffer): string {
  const asUtf8 = buf.toString('utf8')
  // If UTF-8 decode produced lots of replacement chars, fall back to latin1.
  if (asUtf8.includes('\uFFFD') && buf.some((b) => b >= 0x80)) {
    return buf.toString('latin1')
  }
  return asUtf8
}

type ExifEntry = { tag: number; type: number; count: number; valueOffset: number }

/**
 * Best-effort TIFF/EXIF walk for text tags that often hold generation params.
 * Tags: ImageDescription (0x010E), UserComment (0x9286), XPComment (0x9C9C).
 */
export function extractExifTextCandidates(exifBuf: Buffer, options?: { graphs?: boolean }): string[] {
  const out: string[] = []
  if (exifBuf.length < 12) return out

  // Sharp may prepend "Exif\0\0"
  let tiffStart = 0
  if (
    exifBuf.length >= 6 &&
    exifBuf.subarray(0, 4).toString('ascii') === 'Exif' &&
    exifBuf[4] === 0 &&
    exifBuf[5] === 0
  ) {
    tiffStart = 6
  }

  const tiff = exifBuf.subarray(tiffStart)
  if (tiff.length < 8) return out
  const le = tiff.subarray(0, 2).toString('ascii') === 'II'
  const be = tiff.subarray(0, 2).toString('ascii') === 'MM'
  if (!le && !be) return out
  const readU16 = (off: number): number =>
    le ? tiff.readUInt16LE(off) : tiff.readUInt16BE(off)
  const readU32 = (off: number): number =>
    le ? tiff.readUInt32LE(off) : tiff.readUInt32BE(off)

  const visited = new Set<number>()
  const queue: number[] = [readU32(4)]

  const readEntries = (ifdOffset: number): ExifEntry[] => {
    if (ifdOffset < 0 || ifdOffset + 2 > tiff.length) return []
    const n = readU16(ifdOffset)
    const entries: ExifEntry[] = []
    for (let i = 0; i < n; i++) {
      const base = ifdOffset + 2 + i * 12
      if (base + 12 > tiff.length) break
      entries.push({
        tag: readU16(base),
        type: readU16(base + 2),
        count: readU32(base + 4),
        valueOffset: readU32(base + 8)
      })
    }
    return entries
  }

  const typeSize = (type: number): number => {
    switch (type) {
      case 1:
      case 2:
      case 6:
      case 7:
        return 1
      case 3:
      case 8:
        return 2
      case 4:
      case 9:
      case 11:
        return 4
      case 5:
      case 10:
      case 12:
        return 8
      default:
        return 1
    }
  }

  const readValueBytes = (e: ExifEntry): Buffer | null => {
    const size = typeSize(e.type) * e.count
    if (size <= 0 || size > 2_000_000) return null
    if (size <= 4) {
      const inline = Buffer.alloc(4)
      if (le) inline.writeUInt32LE(e.valueOffset, 0)
      else inline.writeUInt32BE(e.valueOffset, 0)
      return inline.subarray(0, size)
    }
    if (e.valueOffset + size > tiff.length) return null
    return tiff.subarray(e.valueOffset, e.valueOffset + size)
  }

  const decodeAscii = (bytes: Buffer): string =>
    bytes.toString('utf8').replace(/\0+$/g, '').trim()

  const decodeUserComment = (bytes: Buffer): string => {
    if (bytes.length <= 8) return decodeAscii(bytes)
    const charset = bytes.subarray(0, 8).toString('ascii').replace(/\0+$/g, '')
    const payload = bytes.subarray(8)
    if (/^UNICODE$/i.test(charset)) {
      // UTF-16; honor TIFF endianness (swap bytes when big-endian).
      const payloadLe = le
        ? payload
        : Buffer.from(payload).swap16()
      return payloadLe.toString('utf16le').replace(/\0+$/g, '').trim()
    }
    if (/^ASCII$/i.test(charset) || charset === '') {
      return decodeAscii(payload)
    }
    // JIS / unknown — try utf8
    return decodeLatin1OrUtf8(payload).replace(/\0+$/g, '').trim()
  }

  const decodeXp = (bytes: Buffer): string =>
    bytes.toString('utf16le').replace(/\0+$/g, '').trim()

  while (queue.length > 0) {
    const off = queue.shift()!
    if (visited.has(off) || off < 0 || off >= tiff.length) continue
    visited.add(off)
    const entries = readEntries(off)
    for (const e of entries) {
      // Exif IFD pointer
      if (e.tag === 0x8769 && e.type === 4 && e.count === 1) {
        queue.push(e.valueOffset)
        continue
      }
      const bytes = readValueBytes(e)
      if (!bytes) continue
      let text = ''
      if (e.tag === 0x010e /* ImageDescription */ && (e.type === 2 || e.type === 1)) {
        text = decodeAscii(bytes)
      } else if (e.tag === 0x9286 /* UserComment */) {
        text = decodeUserComment(bytes)
      } else if (e.tag === 0x9c9c /* XPComment */ && (e.type === 1 || e.type === 7)) {
        text = decodeXp(bytes)
      } else if (options?.graphs && (e.tag === 0x02bc /* XMLPacket */ || e.type === 1 || e.type === 7)) {
        const inflated = inflateIfCompressed(bytes)
        if (inflated) {
          text = inflated
        } else {
          const decoded = decodeLatin1OrUtf8(bytes).replace(/\0+$/g, '').trim()
          if (e.tag === 0x02bc || looksLikeEmbeddedGraph(decoded)) text = decoded
        }
      }
      if (text) out.push(text)
    }
    // Next IFD
    const n = readU16(off)
    const nextOff = off + 2 + n * 12
    if (nextOff + 4 <= tiff.length) {
      const next = readU32(nextOff)
      if (next) queue.push(next)
    }
  }

  return out
}

/** Prefer the candidate that parses as A1111/Comfy parameters. */
export function pickGenerationParametersText(
  candidates: string[],
  looksLike: (s: string) => boolean
): string | null {
  for (const c of candidates) {
    if (looksLike(c)) return c
  }
  return null
}
