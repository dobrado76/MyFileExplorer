import { describe, expect, it } from 'vitest'
import { sniff3ds, sniffFbx, summarizeObj } from '../main/preview/objMesh'

describe('summarizeObj', () => {
  it('counts verts, triangulated faces, and mtllib', () => {
    const text = [
      '# cube-ish',
      'mtllib box.mtl',
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'v 0 1 0',
      'vt 0 0',
      'vn 0 0 1',
      'f 1/1/1 2/1/1 3/1/1 4/1/1',
      'f 1 2 3'
    ].join('\n')
    const s = summarizeObj(text)
    expect(s.vertices).toBe(4)
    expect(s.texcoords).toBe(1)
    expect(s.normals).toBe(1)
    expect(s.faces).toBe(2)
    expect(s.triangles).toBe(3)
    expect(s.mtllib).toBe('box.mtl')
  })
})

describe('sniffFbx / sniff3ds', () => {
  it('detects binary and ASCII FBX', () => {
    const bin = Buffer.concat([Buffer.from('Kaydara FBX Binary  \x00'), Buffer.alloc(8)])
    expect(sniffFbx(bin)).toBe('binary')
    expect(sniffFbx(Buffer.from('; FBX 7.4.0 project file\nFBXHeaderExtension:  {\n'))).toBe(
      'ascii'
    )
    expect(sniffFbx(Buffer.from('not a mesh'))).toBeNull()
  })

  it('detects 3DS main chunk', () => {
    const buf = Buffer.alloc(6)
    buf.writeUInt16LE(0x4d4d, 0)
    buf.writeUInt32LE(6, 2)
    expect(sniff3ds(buf)).toBe(true)
    expect(sniff3ds(Buffer.from('OBJ'))).toBe(false)
  })
})
