import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { extractPngTextChunks } from '../main/preview/pngText'

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function crc32Placeholder(): Buffer {
  return Buffer.alloc(4) // parser skips CRC validation
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, crc32Placeholder()])
}

function textChunk(keyword: string, text: string): Buffer {
  return chunk(
    'tEXt',
    Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')])
  )
}

function itxtChunk(keyword: string, text: string, compressed = false): Buffer {
  const body = compressed ? zlib.deflateSync(Buffer.from(text, 'utf8')) : Buffer.from(text, 'utf8')
  return chunk(
    'iTXt',
    Buffer.concat([
      Buffer.from(keyword, 'latin1'),
      Buffer.from([0, compressed ? 1 : 0, 0]),
      Buffer.from([0]), // empty lang
      Buffer.from([0]), // empty translated keyword
      body
    ])
  )
}

function ztxtChunk(keyword: string, text: string): Buffer {
  return chunk(
    'zTXt',
    Buffer.concat([
      Buffer.from(keyword, 'latin1'),
      Buffer.from([0, 0]),
      zlib.deflateSync(Buffer.from(text, 'latin1'))
    ])
  )
}

function png(...chunks: Buffer[]): Buffer {
  const ihdr = chunk('IHDR', Buffer.alloc(13))
  const iend = chunk('IEND', Buffer.alloc(0))
  return Buffer.concat([SIG, ihdr, ...chunks, iend])
}

describe('extractPngTextChunks', () => {
  it('extracts tEXt chunks', () => {
    const buf = png(textChunk('parameters', 'a cat\nSteps: 20'))
    const chunks = extractPngTextChunks(buf)
    expect(chunks).toEqual([{ keyword: 'parameters', text: 'a cat\nSteps: 20' }])
  })

  it('extracts iTXt utf8 chunks', () => {
    const buf = png(itxtChunk('workflow', '{"nodes":[1,2]}'))
    expect(extractPngTextChunks(buf)).toEqual([{ keyword: 'workflow', text: '{"nodes":[1,2]}' }])
  })

  it('extracts compressed iTXt chunks', () => {
    const buf = png(itxtChunk('parameters', 'compressed prompt', true))
    expect(extractPngTextChunks(buf)).toEqual([
      { keyword: 'parameters', text: 'compressed prompt' }
    ])
  })

  it('extracts zTXt chunks', () => {
    const buf = png(ztxtChunk('Comment', 'zipped'))
    expect(extractPngTextChunks(buf)).toEqual([{ keyword: 'Comment', text: 'zipped' }])
  })

  it('returns empty for non-png data', () => {
    expect(extractPngTextChunks(Buffer.from('not a png at all'))).toEqual([])
  })

  it('survives truncated/malformed chunk tables', () => {
    const buf = png(textChunk('parameters', 'x')).subarray(0, 30)
    expect(() => extractPngTextChunks(Buffer.from(buf))).not.toThrow()
  })

  it('extracts multiple chunks in order', () => {
    const buf = png(textChunk('prompt', '{"1":{}}'), itxtChunk('workflow', '{"w":1}'))
    const chunks = extractPngTextChunks(buf)
    expect(chunks.map((c) => c.keyword)).toEqual(['prompt', 'workflow'])
  })
})
