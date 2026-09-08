import { imageExt, sharpFormatForExt } from '@shared/imageEdit'
import {
  extractExifTextCandidates,
  extractJpegComComments,
  insertJpegComComments
} from '../preview/exifText'
import { extractPngTextChunks, insertPngTextChunks, type PngTextChunk } from '../preview/pngText'

export type PreservedImageMetadata = {
  /** Full PNG tEXt/zTXt/iTXt list (same-format PNG fidelity). */
  pngTextChunks?: PngTextChunk[]
  /** JPEG COM payloads (same-format JPEG). */
  jpegComComments?: string[]
  /**
   * Normalized generation text for cross-format bridging
   * (keyword hints: parameters / Comment / prompt / workflow).
   */
  genTexts?: PngTextChunk[]
  exif?: Buffer
  icc?: Buffer
  iptc?: Buffer
  xmp?: Buffer
}

const GEN_PNG_KEYWORDS = new Set(['parameters', 'comment', 'prompt', 'workflow'])

function looksLikeJsonObject(text: string): boolean {
  const t = text.trim()
  return t.startsWith('{') && t.endsWith('}')
}

function pushUniqueGenText(out: PngTextChunk[], keyword: string, text: string): void {
  const t = text.trim()
  if (!t) return
  if (out.some((c) => c.keyword === keyword && c.text === t)) return
  out.push({ keyword, text: t })
}

function classifyBridgedKeyword(text: string, hint?: string): string {
  if (hint) {
    const h = hint.toLowerCase()
    if (GEN_PNG_KEYWORDS.has(h)) return hint
  }
  const t = text.trim()
  if (looksLikeJsonObject(t)) {
    // Comfy often stores graph JSON in `workflow`; node prompt map in `prompt`.
    if (/"class_type"\s*:/.test(t) || /"nodes"\s*:/.test(t)) return 'workflow'
    return 'prompt'
  }
  if (/\nNegative prompt:/i.test(t) || /\bSteps:\s*\d+/i.test(t)) return 'parameters'
  return 'Comment'
}

/** Build cross-format gen texts from whatever channels were read. */
function buildGenTexts(meta: {
  pngTextChunks?: PngTextChunk[]
  jpegComComments?: string[]
  exif?: Buffer
}): PngTextChunk[] {
  const out: PngTextChunk[] = []
  for (const c of meta.pngTextChunks ?? []) {
    const k = c.keyword.toLowerCase()
    if (GEN_PNG_KEYWORDS.has(k)) pushUniqueGenText(out, c.keyword, c.text)
  }
  for (const com of meta.jpegComComments ?? []) {
    pushUniqueGenText(out, classifyBridgedKeyword(com), com)
  }
  if (meta.exif && meta.exif.length > 0) {
    for (const cand of extractExifTextCandidates(meta.exif)) {
      pushUniqueGenText(out, classifyBridgedKeyword(cand), cand)
    }
  }
  return out
}

/** True when the preserved payload includes generation-related text we care about. */
export function preservedHasGenerationMetadata(meta: PreservedImageMetadata): boolean {
  if ((meta.genTexts?.length ?? 0) > 0) return true
  if (
    meta.pngTextChunks?.some((c) => {
      const k = c.keyword.toLowerCase()
      return GEN_PNG_KEYWORDS.has(k) && c.text.trim().length > 0
    })
  ) {
    return true
  }
  if (meta.jpegComComments?.some((c) => c.trim().length > 0)) return true
  if (meta.exif && extractExifTextCandidates(meta.exif).some((c) => c.trim().length > 0)) {
    return true
  }
  return false
}

/**
 * Whether written bytes still expose generation text the same way preview looks for it.
 */
export function bufferHasGenerationMetadata(bytes: Buffer, ext: string): boolean {
  const normalized = ext.toLowerCase()
  if (normalized === 'png') {
    return extractPngTextChunks(bytes).some((c) => {
      const k = c.keyword.toLowerCase()
      return GEN_PNG_KEYWORDS.has(k) && c.text.trim().length > 0
    })
  }
  if (['jpg', 'jpeg', 'jfif'].includes(normalized)) {
    if (extractJpegComComments(bytes).some((c) => c.trim().length > 0)) return true
  }
  if (['jpg', 'jpeg', 'jfif', 'webp', 'avif', 'tif', 'tiff'].includes(normalized)) {
    // Sync check only for COM above; EXIF needs Sharp — callers use async verify after encode.
    // Best-effort: try to find APP1 Exif without Sharp for JPEG.
    if (['jpg', 'jpeg', 'jfif'].includes(normalized)) {
      const exif = extractRawJpegExifBuffer(bytes)
      if (exif && extractExifTextCandidates(exif).some((c) => c.trim().length > 0)) return true
    }
  }
  return false
}

/** Pull APP1 Exif payload (including "Exif\0\0" prefix) from a JPEG buffer. */
function extractRawJpegExifBuffer(buf: Buffer): Buffer | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
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
    if (marker === 0xe1) {
      const payload = buf.subarray(i + 2, i + len)
      if (
        payload.length >= 6 &&
        payload.subarray(0, 4).toString('ascii') === 'Exif' &&
        payload[4] === 0 &&
        payload[5] === 0
      ) {
        return Buffer.from(payload)
      }
    }
    i += len
  }
  return null
}

/** Async verify for formats where Sharp may hold EXIF (WebP etc.). */
export async function bufferHasGenerationMetadataAsync(
  bytes: Buffer,
  ext: string
): Promise<boolean> {
  if (bufferHasGenerationMetadata(bytes, ext)) return true
  const normalized = ext.toLowerCase()
  if (!['jpg', 'jpeg', 'jfif', 'webp', 'avif', 'tif', 'tiff'].includes(normalized)) {
    return false
  }
  try {
    const { default: sharp } = await import('sharp')
    const meta = await sharp(bytes).metadata()
    if (meta.exif && extractExifTextCandidates(Buffer.from(meta.exif)).some((c) => c.trim())) {
      return true
    }
  } catch {
    /* soft */
  }
  return false
}

/** Read generation / comment metadata we can write back after a pixel re-encode. */
export async function readPreservableImageMetadata(
  bytes: Buffer,
  ext: string
): Promise<PreservedImageMetadata> {
  const out: PreservedImageMetadata = {}
  const normalized = ext.toLowerCase()

  if (normalized === 'png') {
    const chunks = extractPngTextChunks(bytes)
    if (chunks.length > 0) out.pngTextChunks = chunks
  }

  if (['jpg', 'jpeg', 'jfif'].includes(normalized)) {
    const coms = extractJpegComComments(bytes)
    if (coms.length > 0) out.jpegComComments = coms
  }

  if (['jpg', 'jpeg', 'jfif', 'webp', 'avif', 'tif', 'tiff'].includes(normalized)) {
    try {
      const { default: sharp } = await import('sharp')
      const meta = await sharp(bytes).metadata()
      if (meta.exif) out.exif = Buffer.from(meta.exif)
      if (meta.icc) out.icc = Buffer.from(meta.icc)
      if (meta.iptc) out.iptc = Buffer.from(meta.iptc)
      if (meta.xmp) out.xmp = Buffer.from(meta.xmp)
    } catch {
      /* soft — encode still succeeds without metadata */
    }
  }

  const genTexts = buildGenTexts(out)
  if (genTexts.length > 0) out.genTexts = genTexts

  return out
}

function hasExifSidecar(meta: PreservedImageMetadata): boolean {
  return !!(meta.exif || meta.icc || meta.iptc || meta.xmp)
}

function applySharpOutputFormat(
  pipeline: import('sharp').Sharp,
  format: NonNullable<ReturnType<typeof sharpFormatForExt>>
): import('sharp').Sharp {
  if (format === 'jpeg') return pipeline.jpeg({ quality: 92, mozjpeg: true })
  if (format === 'png') return pipeline.png({ compressionLevel: 8 })
  if (format === 'webp') return pipeline.webp({ quality: 90 })
  if (format === 'tiff') return pipeline.tiff()
  if (format === 'gif') return pipeline.gif()
  if (format === 'avif') return pipeline.avif({ quality: 80 })
  return pipeline.toFormat(format)
}

async function applySharpSidecarMetadata(
  encoded: Buffer,
  destExt: string,
  preserved: PreservedImageMetadata
): Promise<Buffer> {
  if (!hasExifSidecar(preserved)) return encoded
  const format = sharpFormatForExt(destExt)
  if (!format) return encoded

  try {
    const { default: sharp } = await import('sharp')
    // Sharp 0.34 types deprecate raw EXIF buffers, but runtime still accepts them.
    const withMeta = {
      ...(preserved.exif ? { exif: preserved.exif } : {}),
      ...(preserved.icc ? { icc: preserved.icc } : {}),
      ...(preserved.iptc ? { iptc: preserved.iptc } : {}),
      ...(preserved.xmp ? { xmp: preserved.xmp.toString('utf8') } : {})
    } as import('sharp').WriteableMetadata

    let pipeline = sharp(encoded).withMetadata(withMeta)
    pipeline = applySharpOutputFormat(pipeline, format)
    return await pipeline.toBuffer()
  } catch {
    return encoded
  }
}

function pngChunksForDest(preserved: PreservedImageMetadata): PngTextChunk[] {
  if (preserved.pngTextChunks && preserved.pngTextChunks.length > 0) {
    return preserved.pngTextChunks
  }
  // Cross-format: synthesize from genTexts
  const out: PngTextChunk[] = []
  for (const g of preserved.genTexts ?? []) {
    pushUniqueGenText(out, classifyBridgedKeyword(g.text, g.keyword), g.text)
  }
  return out
}

function jpegComForDest(preserved: PreservedImageMetadata, destIsJpeg: boolean): string[] {
  if (!destIsJpeg) return []
  if (preserved.jpegComComments && preserved.jpegComComments.length > 0) {
    return preserved.jpegComComments
  }
  // Bridge: put gen texts into COM so preview + Explorer Comments work even if EXIF fails
  const coms: string[] = []
  for (const g of preserved.genTexts ?? []) {
    const t = g.text.trim()
    if (t && !coms.includes(t)) coms.push(t)
  }
  // If we only had EXIF text and no genTexts built somehow, still try EXIF candidates
  if (coms.length === 0 && preserved.exif) {
    for (const c of extractExifTextCandidates(preserved.exif)) {
      const t = c.trim()
      if (t && !coms.includes(t)) coms.push(t)
    }
  }
  return coms
}

/** Re-attach metadata stripped by canvas export / sharp re-encode. */
export async function applyPreservedImageMetadata(
  encoded: Buffer,
  destExt: string,
  preserved: PreservedImageMetadata
): Promise<Buffer> {
  const ext = destExt.toLowerCase()
  const destIsPng = ext === 'png'
  const destIsJpeg = ['jpg', 'jpeg', 'jfif'].includes(ext)
  const destTakesExif = ['jpg', 'jpeg', 'jfif', 'webp', 'avif', 'tif', 'tiff'].includes(ext)

  let out = encoded

  // 1) Sharp sidecar pass first (re-encode wipes any PNG text / COM we might add).
  if (destTakesExif && hasExifSidecar(preserved)) {
    out = await applySharpSidecarMetadata(out, ext, preserved)
  }

  // 2) JPEG COM after Sharp (COM survives as appended markers; Sharp already finished).
  if (destIsJpeg) {
    const coms = jpegComForDest(preserved, true)
    if (coms.length > 0) out = insertJpegComComments(out, coms)
  }

  // 3) PNG text last — never run Sharp after this.
  if (destIsPng) {
    const chunks = pngChunksForDest(preserved)
    if (chunks.length > 0) out = insertPngTextChunks(out, chunks)
  }

  return out
}

export type PreserveMetadataResult = {
  encoded: Buffer
  /** false only when source had gen meta and output does not */
  metadataPreserved: boolean
}

/** Convenience: read metadata from a source file buffer and apply to encoded output. */
export async function preserveMetadataFromSource(
  encoded: Buffer,
  destFile: string,
  sourceBytes: Buffer,
  sourceExt?: string
): Promise<PreserveMetadataResult> {
  const destExt = imageExt(destFile)
  const srcExt = sourceExt ?? destExt
  const preserved = await readPreservableImageMetadata(sourceBytes, srcExt)
  const hadGen = preservedHasGenerationMetadata(preserved)
  const out = await applyPreservedImageMetadata(encoded, destExt, preserved)
  if (!hadGen) {
    return { encoded: out, metadataPreserved: true }
  }
  const ok = await bufferHasGenerationMetadataAsync(out, destExt)
  return { encoded: out, metadataPreserved: ok }
}
