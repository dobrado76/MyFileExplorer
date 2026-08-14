import { imageExt, sharpFormatForExt } from '@shared/imageEdit'
import { extractPngTextChunks, insertPngTextChunks, type PngTextChunk } from '../preview/pngText'

export type PreservedImageMetadata = {
  pngTextChunks?: PngTextChunk[]
  exif?: Buffer
  icc?: Buffer
  iptc?: Buffer
  xmp?: Buffer
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

/** Re-attach metadata stripped by canvas export / sharp re-encode. */
export async function applyPreservedImageMetadata(
  encoded: Buffer,
  destExt: string,
  preserved: PreservedImageMetadata
): Promise<Buffer> {
  const ext = destExt.toLowerCase()
  const hasPng = ext === 'png' && (preserved.pngTextChunks?.length ?? 0) > 0
  const hasExif = hasExifSidecar(preserved)

  if (!hasPng && !hasExif) return encoded

  if (hasPng) {
    encoded = insertPngTextChunks(encoded, preserved.pngTextChunks!)
  }

  if (!hasExif) return encoded

  const format = sharpFormatForExt(ext)
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

/** Convenience: read metadata from a source file buffer and apply to encoded output. */
export async function preserveMetadataFromSource(
  encoded: Buffer,
  destFile: string,
  sourceBytes: Buffer,
  sourceExt?: string
): Promise<Buffer> {
  const destExt = imageExt(destFile)
  const srcExt = sourceExt ?? destExt
  const preserved = await readPreservableImageMetadata(sourceBytes, srcExt)
  return applyPreservedImageMetadata(encoded, destExt, preserved)
}
