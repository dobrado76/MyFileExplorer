import zlib from 'node:zlib'

export type PngTextChunk = { keyword: string; text: string }

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_TEXT_BYTES = 8 * 1024 * 1024

const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[i] = c >>> 0
}

function pngCrc32(type: string, data: Buffer): number {
  const combined = Buffer.concat([Buffer.from(type, 'latin1'), data])
  let crc = 0xffffffff
  for (let i = 0; i < combined.length; i++) {
    crc = CRC_TABLE[(crc ^ combined[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function buildPngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(pngCrc32(type, data), 0)
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, crc])
}

function isLatin1Text(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0xff) return false
  }
  return true
}

function buildPngTextChunk(chunk: PngTextChunk): Buffer {
  const keyword = chunk.keyword.slice(0, 79)
  const text = chunk.text
  if (isLatin1Text(text)) {
    const data = Buffer.concat([
      Buffer.from(keyword, 'latin1'),
      Buffer.from([0]),
      Buffer.from(text, 'latin1')
    ])
    return buildPngChunk('tEXt', data)
  }
  const body = Buffer.from(text, 'utf8')
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, 0, 0]), // uncompressed iTXt
    Buffer.from([0]), // empty language tag
    Buffer.from([0]), // empty translated keyword
    body
  ])
  return buildPngChunk('iTXt', data)
}

/** Insert PNG tEXt/iTXt chunks immediately before `IEND` (best-effort). */
export function insertPngTextChunks(pngBuf: Buffer, chunks: readonly PngTextChunk[]): Buffer {
  if (chunks.length === 0) return pngBuf
  if (pngBuf.length < PNG_SIGNATURE.length + 8) return pngBuf
  if (!pngBuf.subarray(0, 8).equals(PNG_SIGNATURE)) return pngBuf

  let iendStart = -1
  let offset = 8
  while (offset + 8 <= pngBuf.length) {
    const length = pngBuf.readUInt32BE(offset)
    const type = pngBuf.toString('latin1', offset + 4, offset + 8)
    if (type === 'IEND') {
      iendStart = offset
      break
    }
    const dataEnd = offset + 8 + length
    if (dataEnd + 4 > pngBuf.length) break
    offset = dataEnd + 4
  }
  if (iendStart < 0) return pngBuf

  const encoded = chunks.map(buildPngTextChunk)
  return Buffer.concat([pngBuf.subarray(0, iendStart), ...encoded, pngBuf.subarray(iendStart)])
}

/**
 * Extract tEXt / zTXt / iTXt chunks from a PNG buffer.
 * Best effort: malformed chunks are skipped, never thrown.
 */
export function extractPngTextChunks(buf: Buffer): PngTextChunk[] {
  const out: PngTextChunk[] = []
  if (buf.length < PNG_SIGNATURE.length + 8) return out
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return out

  let offset = 8
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('latin1', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (length > buf.length || dataEnd + 4 > buf.length) break
    if (type === 'IEND') break

    if (length <= MAX_TEXT_BYTES && (type === 'tEXt' || type === 'zTXt' || type === 'iTXt')) {
      const data = buf.subarray(dataStart, dataEnd)
      const chunk = parseTextChunk(type, data)
      if (chunk) out.push(chunk)
    }
    offset = dataEnd + 4 // skip CRC
  }
  return out
}

function parseTextChunk(type: string, data: Buffer): PngTextChunk | null {
  try {
    const nul = data.indexOf(0)
    if (nul <= 0 || nul > 79) return null
    const keyword = data.toString('latin1', 0, nul)

    if (type === 'tEXt') {
      return { keyword, text: data.toString('latin1', nul + 1) }
    }

    if (type === 'zTXt') {
      const method = data[nul + 1]
      if (method !== 0) return null
      const inflated = zlib.inflateSync(data.subarray(nul + 2), { maxOutputLength: MAX_TEXT_BYTES })
      return { keyword, text: inflated.toString('latin1') }
    }

    // iTXt: keyword \0 compressionFlag(1) compressionMethod(1) lang \0 translated \0 text
    const compressed = data[nul + 1] === 1
    let p = nul + 3
    const langEnd = data.indexOf(0, p)
    if (langEnd < 0) return null
    p = langEnd + 1
    const translatedEnd = data.indexOf(0, p)
    if (translatedEnd < 0) return null
    p = translatedEnd + 1
    const body = data.subarray(p)
    const text = compressed
      ? zlib.inflateSync(body, { maxOutputLength: MAX_TEXT_BYTES }).toString('utf8')
      : body.toString('utf8')
    return { keyword, text }
  } catch {
    return null
  }
}
