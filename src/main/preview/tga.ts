/** Decode Truevision TGA to RGBA. Sharp/libvips has no TGA sniffer. */

export type TgaRgba = {
  width: number
  height: number
  rgba: Buffer
}

const MAX_DIM = 16384
const MAX_PIXELS = 64 * 1024 * 1024

function u16(buf: Buffer, off: number): number {
  return buf.readUInt16LE(off)
}

function pixelBytes(depth: number): number {
  if (depth === 8) return 1
  if (depth === 15 || depth === 16) return 2
  if (depth === 24) return 3
  if (depth === 32) return 4
  return 0
}

function expandPixel(
  src: Buffer,
  off: number,
  depth: number,
  cmap: Buffer | null,
  cmapDepth: number,
  cmapFirst: number
): [number, number, number, number] {
  if (cmap) {
    const idx = depth === 8 ? src[off]! : u16(src, off)
    const entry = pixelBytes(cmapDepth)
    const o = (idx - cmapFirst) * entry
    if (o < 0 || o + entry > cmap.length) return [0, 0, 0, 255]
    return expandTrueColor(cmap, o, cmapDepth)
  }
  return expandTrueColor(src, off, depth)
}

function expandTrueColor(src: Buffer, off: number, depth: number): [number, number, number, number] {
  if (depth === 8) {
    const v = src[off]!
    return [v, v, v, 255]
  }
  if (depth === 15 || depth === 16) {
    const v = u16(src, off)
    const r = Math.round(((v >> 10) & 31) * (255 / 31))
    const g = Math.round(((v >> 5) & 31) * (255 / 31))
    const b = Math.round((v & 31) * (255 / 31))
    return [r, g, b, 255]
  }
  if (depth === 24) {
    return [src[off + 2]!, src[off + 1]!, src[off]!, 255]
  }
  return [src[off + 2]!, src[off + 1]!, src[off]!, src[off + 3]!]
}

function readRle(
  src: Buffer,
  start: number,
  count: number,
  bpp: number,
  depth: number,
  cmap: Buffer | null,
  cmapDepth: number,
  cmapFirst: number
): { pixels: Buffer; next: number } | null {
  const out = Buffer.alloc(count * 4)
  let i = 0
  let p = start
  while (i < count) {
    if (p >= src.length) return null
    const packet = src[p]!
    p++
    const run = (packet & 0x7f) + 1
    if (packet & 0x80) {
      if (p + bpp > src.length) return null
      const [r, g, b, a] = expandPixel(src, p, depth, cmap, cmapDepth, cmapFirst)
      p += bpp
      for (let n = 0; n < run && i < count; n++, i++) {
        const o = i * 4
        out[o] = r
        out[o + 1] = g
        out[o + 2] = b
        out[o + 3] = a
      }
    } else {
      for (let n = 0; n < run && i < count; n++, i++) {
        if (p + bpp > src.length) return null
        const [r, g, b, a] = expandPixel(src, p, depth, cmap, cmapDepth, cmapFirst)
        p += bpp
        const o = i * 4
        out[o] = r
        out[o + 1] = g
        out[o + 2] = b
        out[o + 3] = a
      }
    }
  }
  return { pixels: out, next: p }
}

/** Decode a TGA buffer. Returns null if the header or payload is not usable. */
export function decodeTga(buf: Buffer): TgaRgba | null {
  if (buf.length < 18) return null
  const idLen = buf[0]!
  const cmapType = buf[1]!
  const imageType = buf[2]!
  const cmapFirst = u16(buf, 3)
  const cmapLen = u16(buf, 5)
  const cmapDepth = buf[7]!
  const width = u16(buf, 12)
  const height = u16(buf, 14)
  const depth = buf[16]!
  const desc = buf[17]!
  if (width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) return null
  if (width * height > MAX_PIXELS) return null
  if (![1, 2, 3, 9, 10, 11].includes(imageType)) return null
  if (cmapType !== 0 && cmapType !== 1) return null

  const mapped = imageType === 1 || imageType === 9
  const rle = imageType === 9 || imageType === 10 || imageType === 11
  const gray = imageType === 3 || imageType === 11
  if (mapped && (cmapType !== 1 || cmapLen < 1)) return null
  if (gray && depth !== 8) return null
  if (!mapped && !gray && ![15, 16, 24, 32].includes(depth)) return null
  if (mapped && ![8, 16].includes(depth)) return null

  const bpp = pixelBytes(mapped ? depth : gray ? 8 : depth)
  if (bpp === 0) return null

  let off = 18 + idLen
  if (off > buf.length) return null

  let cmap: Buffer | null = null
  let cmapEntryDepth = cmapDepth
  if (cmapType === 1 && cmapLen > 0) {
    const entry = pixelBytes(cmapDepth)
    if (entry === 0) return null
    const cmapBytes = cmapLen * entry
    if (off + cmapBytes > buf.length) return null
    cmap = buf.subarray(off, off + cmapBytes)
    off += cmapBytes
    cmapEntryDepth = cmapDepth
  }

  const count = width * height
  const srcDepth = mapped ? depth : gray ? 8 : depth
  let rgba: Buffer
  if (rle) {
    const decoded = readRle(buf, off, count, bpp, srcDepth, cmap, cmapEntryDepth, cmapFirst)
    if (!decoded) return null
    rgba = decoded.pixels
  } else {
    const rawBytes = count * bpp
    if (off + rawBytes > buf.length) return null
    rgba = Buffer.alloc(count * 4)
    for (let i = 0; i < count; i++) {
      const [r, g, b, a] = expandPixel(buf, off + i * bpp, srcDepth, cmap, cmapEntryDepth, cmapFirst)
      const o = i * 4
      rgba[o] = r
      rgba[o + 1] = g
      rgba[o + 2] = b
      rgba[o + 3] = a
    }
  }

  const originTop = (desc & 0x20) !== 0
  const originRight = (desc & 0x10) !== 0
  if (!originTop) {
    const row = width * 4
    const flipped = Buffer.alloc(rgba.length)
    for (let y = 0; y < height; y++) {
      rgba.copy(flipped, (height - 1 - y) * row, y * row, y * row + row)
    }
    rgba = flipped
  }
  if (originRight) {
    const row = width * 4
    for (let y = 0; y < height; y++) {
      const base = y * row
      for (let x = 0; x < Math.floor(width / 2); x++) {
        const a = base + x * 4
        const b = base + (width - 1 - x) * 4
        for (let k = 0; k < 4; k++) {
          const t = rgba[a + k]!
          rgba[a + k] = rgba[b + k]!
          rgba[b + k] = t
        }
      }
    }
  }

  return { width, height, rgba }
}

/** Build a minimal uncompressed 24-bit bottom-left TGA (for tests). */
export function encodeTga24(width: number, height: number, rgbTopLeft: Buffer, originTop = false): Buffer {
  const header = Buffer.alloc(18)
  header[2] = 2
  header.writeUInt16LE(width, 12)
  header.writeUInt16LE(height, 14)
  header[16] = 24
  header[17] = originTop ? 0x20 : 0
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    const srcY = originTop ? y : height - 1 - y
    for (let x = 0; x < width; x++) {
      const si = (srcY * width + x) * 3
      const di = (y * width + x) * 3
      pixels[di] = rgbTopLeft[si + 2]!
      pixels[di + 1] = rgbTopLeft[si + 1]!
      pixels[di + 2] = rgbTopLeft[si]!
    }
  }
  return Buffer.concat([header, pixels])
}
