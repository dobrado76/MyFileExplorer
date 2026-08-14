import { describe, expect, it } from 'vitest'
import {
  describeUvwBuffer,
  extractPrintableStrings,
  inferUvwTopology,
  isOleCompound,
  parseUnityMetaGuid,
  pickUvwStrings
} from '../main/preview/uvw'

function writeF32(buf: Buffer, off: number, x: number, y: number, z = 0): void {
  buf.writeFloatLE(x, off)
  buf.writeFloatLE(y, off + 4)
  buf.writeFloatLE(z, off + 8)
}

function encodeDump(
  verts: [number, number, number][],
  faces: [number, number, number][],
  headerPad = 0
): Buffer {
  const nV = Buffer.alloc(4)
  nV.writeInt32LE(verts.length)
  const vbuf = Buffer.alloc(verts.length * 12)
  verts.forEach((p, i) => writeF32(vbuf, i * 12, p[0], p[1], p[2]))
  const nF = Buffer.alloc(4)
  nF.writeInt32LE(faces.length)
  const fbuf = Buffer.alloc(faces.length * 12)
  faces.forEach((f, i) => {
    fbuf.writeInt32LE(f[0], i * 12)
    fbuf.writeInt32LE(f[1], i * 12 + 4)
    fbuf.writeInt32LE(f[2], i * 12 + 8)
  })
  return Buffer.concat([Buffer.alloc(headerPad), nV, vbuf, nF, fbuf])
}

function encodeISaveChunk(id: number, payload: Buffer, lengthIncludesHeader = false): Buffer {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(id, 0)
  head.writeUInt32LE(lengthIncludesHeader ? payload.length + 6 : payload.length, 2)
  return Buffer.concat([head, payload])
}

describe('parseUnityMetaGuid', () => {
  it('reads a 32-hex guid from Unity YAML', () => {
    const text = [
      'fileFormatVersion: 2',
      'guid: 0123456789abcdef0123456789abcdef',
      'NativeFormatImporter:',
      '  externalObjects: {}'
    ].join('\n')
    expect(parseUnityMetaGuid(text)).toBe('0123456789abcdef0123456789abcdef')
  })

  it('returns null when guid is missing or wrong length', () => {
    expect(parseUnityMetaGuid('fileFormatVersion: 2\n')).toBeNull()
    expect(parseUnityMetaGuid('guid: deadbeef\n')).toBeNull()
  })
})

describe('isOleCompound', () => {
  it('matches the OLE magic', () => {
    const buf = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00])
    expect(isOleCompound(buf)).toBe(true)
  })

  it('rejects short or different headers', () => {
    expect(isOleCompound(Buffer.from([0xd0, 0xcf]))).toBe(false)
    expect(isOleCompound(Buffer.from('UVWMAP'))).toBe(false)
  })
})

describe('extractPrintableStrings / pickUvwStrings', () => {
  it('finds ASCII and UTF-16LE runs', () => {
    const ascii = Buffer.from('xxxx\x00UnwrapUVW\x00junk')
    const utf16 = Buffer.from('U\0n\0w\0r\0a\0p\0 \0M\0o\0d\0i\0f\0i\0e\0r\0')
    expect(extractPrintableStrings(ascii)).toContain('UnwrapUVW')
    expect(extractPrintableStrings(utf16).some((s) => s.includes('Unwrap Modifier'))).toBe(true)
  })

  it('keeps Unwrap-like strings and drops float garbage', () => {
    const picked = pickUvwStrings(['Root Entry', 'UnwrapUVW', 'q je?T', 'di?T', 'n?x:z?@', '@@@'])
    expect(picked).toEqual(['UnwrapUVW'])
  })
})

describe('inferUvwTopology', () => {
  it('reads a count + float3 + count + int3 dump', () => {
    const buf = encodeDump(
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0]
      ],
      [
        [0, 1, 2],
        [1, 3, 2]
      ]
    )
    const topo = inferUvwTopology(buf, buf.length)
    expect(topo).toMatchObject({ vertices: 4, faces: 2, faceStride: 3, vertStride: 3 })
  })

  it('accepts a 4-byte version prefix before the dump', () => {
    const buf = encodeDump(
      [
        [0.1, 0.2, 0],
        [0.3, 0.4, 0],
        [0.5, 0.6, 0]
      ],
      [[0, 1, 2]],
      4
    )
    buf.writeInt32LE(2, 0)
    expect(inferUvwTopology(buf, buf.length)).toMatchObject({ vertices: 3, faces: 1 })
  })

  it('reads ISave chunks (count + payload)', () => {
    const vPay = Buffer.alloc(4 + 3 * 12)
    vPay.writeInt32LE(3, 0)
    writeF32(vPay, 4, 0, 0, 0)
    writeF32(vPay, 16, 1, 0, 0)
    writeF32(vPay, 28, 0, 1, 0)
    const fPay = Buffer.alloc(4 + 12)
    fPay.writeInt32LE(1, 0)
    fPay.writeInt32LE(0, 4)
    fPay.writeInt32LE(1, 8)
    fPay.writeInt32LE(2, 12)
    const buf = Buffer.concat([encodeISaveChunk(0x10, vPay), encodeISaveChunk(0x20, fPay)])
    expect(inferUvwTopology(buf, buf.length)).toMatchObject({ vertices: 3, faces: 1, faceStride: 3 })
  })

  it('does not invent counts from noise or OLE', () => {
    expect(inferUvwTopology(Buffer.alloc(64), 64)).toBeNull()
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(40)
    ])
    expect(inferUvwTopology(ole, ole.length)).toBeNull()
  })
})

describe('describeUvwBuffer', () => {
  it('always identifies the format without inventing counts', () => {
    const { subtitle, typeLabel, fields } = describeUvwBuffer(Buffer.alloc(0))
    expect(subtitle).toBe('3ds Max UVW map')
    expect(typeLabel).toBe('3ds Max UVW map')
    const ids = fields.map((f) => f.id)
    expect(ids).toContain('uvw.format')
    expect(ids).toContain('uvw.contents')
    expect(ids).not.toContain('uvw.vertices')
    expect(ids).not.toContain('uvw.faces')
    expect(ids).not.toContain('uvw.uvRange')
  })

  it('shows UV vertex/face counts and range for a valid dump', () => {
    const buf = encodeDump(
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0]
      ],
      [[0, 1, 2]]
    )
    const { fields } = describeUvwBuffer(buf)
    expect(fields.find((f) => f.id === 'uvw.vertices')?.value).toBe('3')
    expect(fields.find((f) => f.id === 'uvw.faces')?.value).toBe('1 (triangles)')
    expect(fields.find((f) => f.id === 'uvw.uvRange')?.value).toMatch(/U /)
    expect(fields.find((f) => f.id === 'uvw.strings')).toBeUndefined()
  })

  it('does not surface float-as-text junk as labels', () => {
    const junk = Buffer.alloc(48)
    junk.writeFloatLE(0.75, 0)
    junk.writeFloatLE(0.5, 4)
    junk.writeFloatLE(0.25, 8)
    const { fields } = describeUvwBuffer(junk)
    expect(fields.find((f) => f.id === 'uvw.strings')).toBeUndefined()
  })

  it('adds OLE + Unity sidecar fields when present', () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    const { fields } = describeUvwBuffer(ole, {
      unityGuid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      unityMetaName: 'Foo.uvw.meta'
    })
    expect(fields.find((f) => f.id === 'uvw.container')?.value).toMatch(/OLE/)
    expect(fields.find((f) => f.id === 'uvw.unityGuid')?.value).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
    expect(fields.find((f) => f.id === 'uvw.unityMeta')?.value).toBe('Foo.uvw.meta')
  })
})
