import zlib from 'node:zlib'

export type PngTextChunk = { keyword: string; text: string }

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_TEXT_BYTES = 8 * 1024 * 1024

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
