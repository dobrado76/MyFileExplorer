import { describe, expect, it } from 'vitest'
import { decodeTga, encodeTga24 } from '../main/preview/tga'

describe('decodeTga', () => {
  it('decodes uncompressed 24-bit bottom-left TGA as top-left RGBA', () => {
    const rgb = Buffer.from([
      255, 0, 0, 0, 255, 0, // top: red, green
      0, 0, 255, 255, 255, 255 // bottom: blue, white
    ])
    const tga = encodeTga24(2, 2, rgb, false)
    const out = decodeTga(tga)
    expect(out).not.toBeNull()
    expect(out!.width).toBe(2)
    expect(out!.height).toBe(2)
    expect([...out!.rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255])
    expect([...out!.rgba.subarray(4, 8)]).toEqual([0, 255, 0, 255])
    expect([...out!.rgba.subarray(8, 12)]).toEqual([0, 0, 255, 255])
    expect([...out!.rgba.subarray(12, 16)]).toEqual([255, 255, 255, 255])
  })

  it('keeps top-left origin without flipping', () => {
    const rgb = Buffer.from([10, 20, 30, 40, 50, 60])
    const tga = encodeTga24(2, 1, rgb, true)
    const out = decodeTga(tga)
    expect(out).not.toBeNull()
    expect([...out!.rgba.subarray(0, 3)]).toEqual([10, 20, 30])
    expect([...out!.rgba.subarray(4, 7)]).toEqual([40, 50, 60])
  })

  it('decodes RLE true-color 32-bit', () => {
    const header = Buffer.alloc(18)
    header[2] = 10
    header.writeUInt16LE(3, 12)
    header.writeUInt16LE(1, 14)
    header[16] = 32
    header[17] = 0x20
    const packet = Buffer.from([
      0x82, // RLE, 3 pixels
      10,
      20,
      30,
      255
    ])
    const out = decodeTga(Buffer.concat([header, packet]))
    expect(out).not.toBeNull()
    expect(out!.width).toBe(3)
    expect([...out!.rgba.subarray(0, 4)]).toEqual([30, 20, 10, 255])
    expect([...out!.rgba.subarray(8, 12)]).toEqual([30, 20, 10, 255])
  })

  it('rejects garbage', () => {
    expect(decodeTga(Buffer.from('not a tga'))).toBeNull()
    expect(decodeTga(Buffer.alloc(18))).toBeNull()
  })
})
