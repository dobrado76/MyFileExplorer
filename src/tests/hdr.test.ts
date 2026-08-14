import { describe, expect, it } from 'vitest'
import {
  decodeHdr,
  encodeHdrRgbe,
  hdrLayoutHint,
  hdrPreviewFields,
  parseHdrHeader,
  unknownHdrFields
} from '../main/preview/hdr'

function rgbePixel(r: number, g: number, b: number, e: number): Buffer {
  return Buffer.from([r, g, b, e])
}

describe('parseHdrHeader', () => {
  it('reads Radiance RGBE size and exposure', () => {
    const buf = encodeHdrRgbe(4, 2, Buffer.alloc(4 * 2 * 4), 'EXPOSURE=2.5\nGAMMA=1.8')
    const h = parseHdrHeader(buf)
    expect(h).not.toBeNull()
    expect(h!.magic).toBe('RADIANCE')
    expect(h!.format).toBe('rgbe')
    expect(h!.width).toBe(4)
    expect(h!.height).toBe(2)
    expect(h!.exposure).toBe(2.5)
    expect(h!.gamma).toBe(1.8)
    expect(h!.orientation).toBe('-Y 2 +X 4')
  })

  it('accepts #?RGBE', () => {
    const buf = Buffer.from('#?RGBE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n\x80\x80\x80\x80')
    expect(parseHdrHeader(buf)?.magic).toBe('RGBE')
  })

  it('rejects non-Radiance payloads', () => {
    expect(parseHdrHeader(Buffer.from('not an hdr'))).toBeNull()
    expect(parseHdrHeader(Buffer.alloc(348))).toBeNull()
  })
})

describe('hdrLayoutHint', () => {
  it('flags 2:1 as equirectangular skybox', () => {
    expect(hdrLayoutHint(4096, 2048)).toMatch(/Equirectangular/)
    expect(hdrLayoutHint(512, 512)).toBeNull()
  })
})

describe('decodeHdr', () => {
  it('decodes uncompressed -Y +X RGBE', () => {
    const left = rgbePixel(200, 10, 10, 128)
    const right = rgbePixel(10, 10, 200, 128)
    const buf = encodeHdrRgbe(2, 1, Buffer.concat([left, right]))
    const out = decodeHdr(buf)
    expect(out).not.toBeNull()
    expect(out!.width).toBe(2)
    expect(out!.height).toBe(1)
    expect(out!.rgba[3]).toBe(255)
    expect(out!.rgba[0]!).toBeGreaterThan(out!.rgba[4]!)
    expect(out!.rgba[6]!).toBeGreaterThan(out!.rgba[2]!)
  })

  it('decodes new RLE scanlines', () => {
    const head = Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 8\n')
    const rle = Buffer.from([
      2,
      2,
      0,
      8,
      136,
      200,
      136,
      8,
      136,
      8,
      136,
      128
    ])
    const out = decodeHdr(Buffer.concat([head, rle]))
    expect(out).not.toBeNull()
    expect(out!.width).toBe(8)
    expect(out!.rgba[0]!).toBeGreaterThan(80)
    expect(out!.rgba[28]!).toBeGreaterThan(80)
  })

  it('puts +Y first scanline at the bottom', () => {
    const topish = rgbePixel(200, 10, 10, 128)
    const botish = rgbePixel(10, 10, 200, 128)
    const head = Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n+Y 2 +X 1\n')
    const buf = Buffer.concat([head, topish, botish])
    const out = decodeHdr(buf)
    expect(out).not.toBeNull()
    // first scanline → y=1 (bottom); second → y=0 (top)
    expect(out!.rgba[4]!).toBeGreaterThan(out!.rgba[0]!)
    expect(out!.rgba[2]!).toBeGreaterThan(out!.rgba[6]!)
  })
})

describe('hdrPreviewFields', () => {
  it('describes format and 2:1 layout without inventing mesh data', () => {
    const buf = encodeHdrRgbe(4, 2, Buffer.alloc(32))
    const fields = hdrPreviewFields(parseHdrHeader(buf)!)
    expect(fields.find((f) => f.id === 'hdr.format')?.value).toMatch(/RGBE/)
    expect(fields.find((f) => f.id === 'hdr.layout')?.value).toMatch(/Equirectangular/)
    expect(fields.find((f) => f.id === 'hdr.usedAs')?.value).toMatch(/skybox/)
    expect(fields.some((f) => /vertex|face count/i.test(f.value))).toBe(false)
  })

  it('explains unknown .hdr', () => {
    const fields = unknownHdrFields()
    expect(fields[0]?.value).toMatch(/not Radiance/i)
  })
})
