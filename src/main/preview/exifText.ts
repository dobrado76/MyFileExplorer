/**
 * Pull candidate A1111-style parameter strings from JPEG/WebP EXIF and COM markers.
 * ComfyUI image-savers typically store them in UserComment (and Windows shows that as Comments).
 */

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
export function extractExifTextCandidates(exifBuf: Buffer): string[] {
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
