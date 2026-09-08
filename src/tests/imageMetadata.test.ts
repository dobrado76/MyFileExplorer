import { describe, expect, it } from 'vitest'
import { extractPngTextChunks } from '../main/preview/pngText'
import {
  extractJpegComComments,
  insertJpegComComments
} from '../main/preview/exifText'
import {
  applyPreservedImageMetadata,
  bufferHasGenerationMetadata,
  preserveMetadataFromSource,
  readPreservableImageMetadata
} from '../main/fs/imageMetadata'

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, crc])
}

function pngText(keyword: string, text: string): Buffer {
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0]),
    Buffer.from(text, 'latin1')
  ])
  return pngChunk('tEXt', data)
}

function pngWithChunks(...textChunks: Buffer[]): Buffer {
  const ihdr = pngChunk('IHDR', Buffer.alloc(13))
  const iend = pngChunk('IEND', Buffer.alloc(0))
  return Buffer.concat([SIG, ihdr, ...textChunks, iend])
}

function jpegWithCom(comment: string): Buffer {
  const payload = Buffer.from(comment, 'utf8')
  const com = Buffer.alloc(2 + 2 + payload.length)
  com[0] = 0xff
  com[1] = 0xfe
  com.writeUInt16BE(2 + payload.length, 2)
  payload.copy(com, 4)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), com, Buffer.from([0xff, 0xd9])])
}

/** Minimal valid 1×1 PNG produced by sharp — simulates editor re-encode output. */
async function tinySharpPng(): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  return sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } }
  })
    .png()
    .toBuffer()
}

async function tinySharpJpeg(): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  return sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } }
  })
    .jpeg({ quality: 90 })
    .toBuffer()
}

const A1111 = 'a cat\nNegative prompt: blurry\nSteps: 28, Sampler: Euler, Seed: 42'
const COMFY_PROMPT = '{"3":{"class_type":"KSampler","inputs":{}}}'
const COMFY_WORKFLOW = '{"nodes":[{"type":"KSampler"}],"links":[]}'

describe('imageMetadata preservation', () => {
  it('reads PNG text chunks for preservation', async () => {
    const src = pngWithChunks(pngText('parameters', 'prompt text\nSteps: 20'))
    const meta = await readPreservableImageMetadata(src, 'png')
    expect(meta.pngTextChunks).toEqual([{ keyword: 'parameters', text: 'prompt text\nSteps: 20' }])
    expect(meta.genTexts?.some((g) => g.keyword === 'parameters')).toBe(true)
  })

  it('re-applies PNG generation chunks after sharp re-encode', async () => {
    const src = pngWithChunks(pngText('parameters', A1111))
    const preserved = await readPreservableImageMetadata(src, 'png')
    const encoded = await tinySharpPng()
    const out = await applyPreservedImageMetadata(encoded, 'png', preserved)
    const chunks = extractPngTextChunks(out)
    expect(chunks.some((c) => c.keyword === 'parameters' && c.text.includes('Steps: 28'))).toBe(
      true
    )
    expect(bufferHasGenerationMetadata(out, 'png')).toBe(true)
  })

  it('re-applies Comfy prompt + workflow PNG chunks', async () => {
    const src = pngWithChunks(
      pngText('prompt', COMFY_PROMPT),
      pngText('workflow', COMFY_WORKFLOW)
    )
    const preserved = await readPreservableImageMetadata(src, 'png')
    const encoded = await tinySharpPng()
    const out = await applyPreservedImageMetadata(encoded, 'png', preserved)
    const chunks = extractPngTextChunks(out)
    expect(chunks.some((c) => c.keyword === 'prompt' && c.text.includes('KSampler'))).toBe(true)
    expect(chunks.some((c) => c.keyword === 'workflow' && c.text.includes('nodes'))).toBe(true)
  })

  it('preserves JPEG COM-only A1111 parameters after re-encode', async () => {
    const src = jpegWithCom(A1111)
    const preserved = await readPreservableImageMetadata(src, 'jpg')
    expect(preserved.jpegComComments?.[0]).toContain('Steps: 28')
    const encoded = await tinySharpJpeg()
    const out = await applyPreservedImageMetadata(encoded, 'jpg', preserved)
    const coms = extractJpegComComments(out)
    expect(coms.some((c) => c.includes('Steps: 28'))).toBe(true)
    expect(bufferHasGenerationMetadata(out, 'jpg')).toBe(true)
  })

  it('insertJpegComComments round-trips', () => {
    const bare = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    const withCom = insertJpegComComments(bare, [A1111])
    expect(extractJpegComComments(withCom)).toEqual([A1111])
  })

  it('bridges PNG parameters → JPEG COM', async () => {
    const src = pngWithChunks(pngText('parameters', A1111))
    const result = await preserveMetadataFromSource(
      await tinySharpJpeg(),
      'out.jpg',
      src,
      'png'
    )
    expect(result.metadataPreserved).toBe(true)
    expect(extractJpegComComments(result.encoded).some((c) => c.includes('Steps: 28'))).toBe(true)
  })

  it('bridges JPEG COM → PNG tEXt parameters', async () => {
    const src = jpegWithCom(A1111)
    const result = await preserveMetadataFromSource(
      await tinySharpPng(),
      'out.png',
      src,
      'jpg'
    )
    expect(result.metadataPreserved).toBe(true)
    const chunks = extractPngTextChunks(result.encoded)
    expect(chunks.some((c) => c.keyword === 'parameters' && c.text.includes('Steps: 28'))).toBe(
      true
    )
  })

  it('reports metadataPreserved false when gen meta cannot be applied to GIF', async () => {
    const src = pngWithChunks(pngText('parameters', A1111))
    // GIF dest has no preserve write path for gen text
    const result = await preserveMetadataFromSource(
      Buffer.from('GIF89a'),
      'out.gif',
      src,
      'png'
    )
    expect(result.metadataPreserved).toBe(false)
  })
})

describe('EXIF UserComment preserve path', () => {
  it('reads EXIF text candidates when present on JPEG via Sharp metadata', async () => {
    // Build JPEG with COM (always works); also verify EXIF path does not wipe COM
    const src = jpegWithCom(A1111)
    const meta = await readPreservableImageMetadata(src, 'jpeg')
    expect(meta.genTexts?.length).toBeGreaterThan(0)
    const encoded = await tinySharpJpeg()
    // Simulate having EXIF from another source by attaching nothing — COM still applied
    const out = await applyPreservedImageMetadata(encoded, 'jpeg', meta)
    expect(extractJpegComComments(out)[0]).toContain('Negative prompt')
  })

  it('keeps COM even when EXIF sidecar re-apply is attempted', async () => {
    const src = jpegWithCom(A1111)
    const meta = await readPreservableImageMetadata(src, 'jpg')
    // Fabricate a tiny EXIF buffer that Sharp may reject — COM fallback must still win
    meta.exif = Buffer.from('not-real-exif')
    const out = await applyPreservedImageMetadata(await tinySharpJpeg(), 'jpg', meta)
    expect(extractJpegComComments(out).some((c) => c.includes('Steps: 28'))).toBe(true)
  })
})
