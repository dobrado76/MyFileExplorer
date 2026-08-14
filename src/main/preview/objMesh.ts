/** Cheap Wavefront OBJ counts (no geometry build). */

export type ObjSummary = {
  vertices: number
  texcoords: number
  normals: number
  faces: number
  triangles: number
  mtllib: string | null
}

export function summarizeObj(text: string): ObjSummary {
  let vertices = 0
  let texcoords = 0
  let normals = 0
  let faces = 0
  let triangles = 0
  let mtllib: string | null = null

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('v ')) vertices++
    else if (line.startsWith('vt ')) texcoords++
    else if (line.startsWith('vn ')) normals++
    else if (line.startsWith('f ')) {
      faces++
      let n = 0
      for (const tok of line.slice(2).trim().split(/\s+/)) {
        if (tok && tok !== '\\') n++
      }
      if (n >= 3) triangles += n - 2
    } else if (!mtllib && line.toLowerCase().startsWith('mtllib ')) {
      const name = line.slice(7).trim()
      if (name) mtllib = name
    }
  }

  return { vertices, texcoords, normals, faces, triangles, mtllib }
}

export function sniffFbx(buf: Buffer): 'ascii' | 'binary' | null {
  if (buf.length >= 20 && buf.subarray(0, 20).toString('latin1') === 'Kaydara FBX Binary  ') {
    return 'binary'
  }
  const head = buf.subarray(0, Math.min(buf.length, 256)).toString('latin1')
  if (/^\s*;\s*FBX/i.test(head) || /^\s*FBXHeaderExtension/i.test(head)) return 'ascii'
  return null
}

/** 3D Studio mesh — primary chunk id 0x4D4D. */
export function sniff3ds(buf: Buffer): boolean {
  return buf.length >= 6 && buf.readUInt16LE(0) === 0x4d4d
}
