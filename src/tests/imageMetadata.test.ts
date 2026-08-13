import { describe, expect, it } from 'vitest'
import { extractPngTextChunks } from '../main/preview/pngText'
import {
  applyPreservedImageMetadata,
  readPreservableImageMetadata
} from '../main/fs/imageMetadata'

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)])
}

function pngWithParameters(params: string): Buffer {
  const data = Buffer.concat([
    Buffer.from('parameters', 'latin1'),
    Buffer.from([0]),
    Buffer.from(params, 'latin1')
  ])
  const ihdr = pngChunk('IHDR', Buffer.alloc(13))
  const text = pngChunk('tEXt', data)
  const iend = pngChunk('IEND', Buffer.alloc(0))
  return Buffer.concat([SIG, ihdr, text, iend])
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

describe('imageMetadata preservation', () => {
  it('reads PNG text chunks for preservation', async () => {
    const src = pngWithParameters('prompt text\nSteps: 20')
    const meta = await readPreservableImageMetadata(src, 'png')
    expect(meta.pngTextChunks).toEqual([{ keyword: 'parameters', text: 'prompt text\nSteps: 20' }])
  })

  it('re-applies PNG generation chunks after sharp re-encode', async () => {
    const src = pngWithParameters('a cat\nNegative prompt: blurry\nSteps: 28')
    const preserved = await readPreservableImageMetadata(src, 'png')
    const encoded = await tinySharpPng()
    const out = await applyPreservedImageMetadata(encoded, 'png', preserved)
    const chunks = extractPngTextChunks(out)
    expect(chunks.some((c) => c.keyword === 'parameters' && c.text.includes('Steps: 28'))).toBe(
      true
    )
  })
})
