/**
 * 3ds Max Unwrap UVW (`.uvw`) — identification + topology when the bytes fit.
 * Proprietary; counts are shown only when size + UV/index checks agree.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { PreviewField } from '@shared/schemas/preview'

export const UVW_SNIFF_BYTES = 64 * 1024
/** Read the whole file when small enough to validate face indices. */
export const UVW_PARSE_MAX_BYTES = 8 * 1024 * 1024

/** OLE compound document (some Max saves). */
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

const INTERESTING = /unwrap|uvw|3ds|max|autodesk|modifier|map.?channel|channel/i
const OLE_BOILER = /^(root entry|contents|compobj|ole|book|workbook)$/i

const MAX_VERTS = 5_000_000
const MAX_FACES = 10_000_000

export type UvwDescribe = {
  subtitle: string
  typeLabel: string
  fields: PreviewField[]
}

export type UvwTopology = {
  vertices: number
  faces: number | null
  vertStride: 2 | 3
  faceStride: 3 | 4 | null
  vertOff: number
}

export function parseUnityMetaGuid(text: string): string | null {
  const m = text.match(/^\s*guid:\s*([0-9a-f]{32})\s*$/im)
  return m ? m[1] : null
}

export function isOleCompound(buf: Buffer): boolean {
  return buf.length >= OLE_MAGIC.length && buf.subarray(0, OLE_MAGIC.length).equals(OLE_MAGIC)
}

export function extractPrintableStrings(buf: Buffer, minLen = 4): string[] {
  const out: string[] = []
  let run = ''
  const flush = (): void => {
    if (run.length >= minLen) out.push(run.slice(0, 80))
    run = ''
  }
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]!
    if (b >= 0x20 && b <= 0x7e) run += String.fromCharCode(b)
    else flush()
  }
  flush()

  let i = 0
  while (i + 1 < buf.length) {
    let s = ''
    let j = i
    while (j + 1 < buf.length) {
      const c = buf.readUInt16LE(j)
      if (c >= 0x20 && c <= 0x7e) {
        s += String.fromCharCode(c)
        j += 2
      } else break
    }
    if (s.length >= minLen) {
      out.push(s.slice(0, 80))
      i = j
    } else {
      i += 1
    }
  }
  return out
}

export function pickUvwStrings(raw: string[]): string[] {
  const uniq: string[] = []
  const seen = new Set<string>()
  for (const s of raw) {
    const t = s.trim()
    if (!t || seen.has(t.toLowerCase())) continue
    if (OLE_BOILER.test(t)) continue
    if (!INTERESTING.test(t)) continue
    seen.add(t.toLowerCase())
    uniq.push(t)
  }
  return uniq.slice(0, 6)
}

function plausibleTopo(nV: number, nF: number): boolean {
  return nV >= 3 && nF >= 1 && nV <= MAX_VERTS && nF <= MAX_FACES && nF <= nV * 8 && nV <= nF * 8
}

function floatsLookLikeUv(buf: Buffer, off: number, count: number, stride: 2 | 3): boolean {
  if (count < 1) return false
  const n = Math.min(count, 12)
  if (off + n * stride * 4 > buf.length) return false
  let ok = 0
  for (let i = 0; i < n; i++) {
    const base = off + i * stride * 4
    const u = buf.readFloatLE(base)
    const v = buf.readFloatLE(base + 4)
    const w = stride === 3 ? buf.readFloatLE(base + 8) : 0
    if (!Number.isFinite(u) || !Number.isFinite(v) || !Number.isFinite(w)) return false
    if (Math.abs(u) <= 8 && Math.abs(v) <= 8 && Math.abs(w) <= 8) ok++
  }
  return ok >= Math.ceil(n * 0.75)
}

function intsLookLikeIndices(
  buf: Buffer,
  off: number,
  nF: number,
  nV: number,
  stride: 3 | 4
): boolean {
  const n = Math.min(nF, 16)
  if (off + n * stride * 4 > buf.length) return true
  const tryBase = (base: 0 | 1): boolean => {
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < stride; k++) {
        const idx = buf.readInt32LE(off + (i * stride + k) * 4)
        if (idx < base || idx >= nV + base) return false
      }
    }
    return true
  }
  return tryBase(0) || tryBase(1)
}

function uvRange(buf: Buffer, off: number, nV: number, stride: 2 | 3): string | null {
  const n = Math.min(nV, 256)
  if (off + n * stride * 4 > buf.length) return null
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity
  for (let i = 0; i < n; i++) {
    const u = buf.readFloatLE(off + i * stride * 4)
    const v = buf.readFloatLE(off + i * stride * 4 + 4)
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null
    if (u < u0) u0 = u
    if (u > u1) u1 = u
    if (v < v0) v0 = v
    if (v > v1) v1 = v
  }
  const fmt = (x: number): string => (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(3))
  const sampled = n < nV ? ` (first ${n})` : ''
  return `U ${fmt(u0)}–${fmt(u1)}, V ${fmt(v0)}–${fmt(v1)}${sampled}`
}

function consider(
  buf: Buffer,
  fileSize: number,
  countOff: number,
  nV: number,
  vertStride: 2 | 3
): (UvwTopology & { vertOff: number; faceOff: number | null }) | null {
  if (nV < 3 || nV > MAX_VERTS) return null
  const vertOff = countOff + 4
  const vertBytes = nV * vertStride * 4
  const vertEnd = vertOff + vertBytes
  if (vertEnd > fileSize) return null
  if (vertOff + Math.min(nV, 3) * vertStride * 4 <= buf.length) {
    if (!floatsLookLikeUv(buf, vertOff, Math.min(nV, 12), vertStride)) return null
  }

  if (vertEnd === fileSize) {
    return { vertices: nV, faces: null, vertStride, faceStride: null, vertOff, faceOff: null }
  }

  const tryFaces = (
    faceCountOff: number | null,
    faceOff: number,
    faceStride: 3 | 4
  ): (UvwTopology & { vertOff: number; faceOff: number | null }) | null => {
    let nF: number | null = null
    if (faceCountOff != null) {
      if (faceCountOff + 4 <= buf.length) nF = buf.readInt32LE(faceCountOff)
      else {
        const fb = fileSize - faceOff
        if (fb > 0 && fb % (faceStride * 4) === 0) nF = fb / (faceStride * 4)
      }
    } else {
      const fb = fileSize - faceOff
      if (fb > 0 && fb % (faceStride * 4) === 0) nF = fb / (faceStride * 4)
    }
    if (nF == null || !plausibleTopo(nV, nF)) return null
    if (faceOff + nF * faceStride * 4 !== fileSize) return null
    if (!intsLookLikeIndices(buf, faceOff, nF, nV, faceStride)) return null
    return { vertices: nV, faces: nF, vertStride, faceStride, vertOff, faceOff }
  }

  if (vertEnd + 4 <= fileSize) {
    const withCount3 = tryFaces(vertEnd, vertEnd + 4, 3)
    if (withCount3) return withCount3
    const withCount4 = tryFaces(vertEnd, vertEnd + 4, 4)
    if (withCount4) return withCount4
  }
  const bare3 = tryFaces(null, vertEnd, 3)
  if (bare3) return bare3
  const bare4 = tryFaces(null, vertEnd, 4)
  if (bare4) return bare4
  return null
}

function walkISaveChunks(
  buf: Buffer,
  fileSize: number,
  lengthIncludesHeader: boolean
): UvwTopology | null {
  let pos = 0
  let verts: UvwTopology | null = null
  let guard = 0
  while (pos + 6 <= buf.length && pos < fileSize && guard++ < 256) {
    const rawLen = buf.readUInt32LE(pos + 2)
    const payload = lengthIncludesHeader ? rawLen - 6 : rawLen
    const next = lengthIncludesHeader ? pos + rawLen : pos + 6 + rawLen
    if (payload < 0 || next > fileSize || next <= pos) break
    const dataOff = pos + 6
    if (dataOff + 4 <= buf.length) {
      const n = buf.readInt32LE(dataOff)
      if (n >= 3 && n <= MAX_VERTS && 4 + n * 12 === payload) {
        if (floatsLookLikeUv(buf, dataOff + 4, Math.min(n, 12), 3)) {
          verts = { vertices: n, faces: null, vertStride: 3, faceStride: null, vertOff: dataOff + 4 }
        }
      }
      if (verts && n >= 1 && n <= MAX_FACES && 4 + n * 12 === payload) {
        if (plausibleTopo(verts.vertices, n) && intsLookLikeIndices(buf, dataOff + 4, n, verts.vertices, 3)) {
          return { ...verts, faces: n, faceStride: 3 }
        }
      }
      if (verts && n >= 1 && n <= MAX_FACES && 4 + n * 16 === payload) {
        if (plausibleTopo(verts.vertices, n) && intsLookLikeIndices(buf, dataOff + 4, n, verts.vertices, 4)) {
          return { ...verts, faces: n, faceStride: 4 }
        }
      }
    }
    if (!verts && payload >= 36 && payload % 12 === 0 && dataOff + 36 <= buf.length) {
      const n = payload / 12
      if (n >= 3 && n <= MAX_VERTS && floatsLookLikeUv(buf, dataOff, Math.min(n, 12), 3)) {
        verts = { vertices: n, faces: null, vertStride: 3, faceStride: null, vertOff: dataOff }
      }
    }
    pos = next
  }
  return verts
}

/**
 * Infer UV vertex/face counts when a dump or ISave-chunk layout matches `fileSize`.
 * Does not guess from OLE compound files.
 */
export function inferUvwTopology(buf: Buffer, fileSize: number): UvwTopology | null {
  if (fileSize < 16 || buf.length < 4 || isOleCompound(buf)) return null
  const limit = Math.min(64, buf.length - 4)
  for (let off = 0; off <= limit; off += 4) {
    const nV = buf.readInt32LE(off)
    const hit3 = consider(buf, fileSize, off, nV, 3)
    if (hit3) return hit3
    const hit2 = consider(buf, fileSize, off, nV, 2)
    if (hit2) return hit2
  }
  return walkISaveChunks(buf, fileSize, false) ?? walkISaveChunks(buf, fileSize, true)
}

function field(id: string, label: string, value: string, copyable = false): PreviewField {
  return { id, label, value, group: 'other', copyable }
}

function fmtCount(n: number): string {
  return n.toLocaleString('en-US')
}

export function describeUvwBuffer(
  buf: Buffer,
  opts?: { fileSize?: number; unityGuid?: string | null; unityMetaName?: string | null }
): UvwDescribe {
  const typeLabel = '3ds Max UVW map'
  const subtitle = typeLabel
  const fileSize = opts?.fileSize ?? buf.length
  const topo = inferUvwTopology(buf, fileSize)

  const fields: PreviewField[] = [
    field('uvw.format', 'Format', 'Autodesk 3ds Max Unwrap UVW'),
    field(
      'uvw.contents',
      'Contents',
      'Texture-space vertices and faces (U/V/W). No 3D mesh positions or texture image.'
    ),
    field('uvw.usedBy', 'Used by', '3ds Max Save/Load UVs. Unity does not read this file.'),
    field(
      'uvw.note',
      'Note',
      'Apply only to a mesh with the same topology the UVs were saved from. UV vertex count is often higher than mesh verts (seams).'
    )
  ]

  if (topo) {
    fields.push(field('uvw.vertices', 'UV vertices', fmtCount(topo.vertices)))
    if (topo.faces != null && topo.faceStride != null) {
      const kind = topo.faceStride === 3 ? 'triangles' : 'quads'
      fields.push(field('uvw.faces', 'UV faces', `${fmtCount(topo.faces)} (${kind})`))
    }
    const range = uvRange(buf, topo.vertOff, topo.vertices, topo.vertStride)
    if (range) fields.push(field('uvw.uvRange', 'UV range', range))
  }

  if (isOleCompound(buf)) {
    fields.push(field('uvw.container', 'Container', 'OLE compound document (Max-style)'))
  }

  const strings = pickUvwStrings(extractPrintableStrings(buf))
  if (strings.length) {
    fields.push(field('uvw.strings', 'Labels', strings.join('\n'), true))
  }

  if (opts?.unityGuid) {
    fields.push(field('uvw.unityGuid', 'Unity GUID', opts.unityGuid, true))
  }
  if (opts?.unityMetaName) {
    fields.push(field('uvw.unityMeta', 'Unity sidecar', opts.unityMetaName, true))
  }

  return { subtitle, typeLabel, fields }
}

export async function buildUvwPreviewFields(
  file: string,
  fileSize: number
): Promise<UvwDescribe> {
  const n = Math.min(
    fileSize <= UVW_PARSE_MAX_BYTES ? fileSize : UVW_SNIFF_BYTES,
    Math.max(0, fileSize)
  )
  let buf = Buffer.alloc(0)
  if (n > 0) {
    const handle = await fsp.open(file, 'r')
    try {
      buf = Buffer.alloc(n)
      const { bytesRead } = await handle.read(buf, 0, n, 0)
      buf = buf.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  let unityGuid: string | null = null
  let unityMetaName: string | null = null
  try {
    const metaPath = `${file}.meta`
    const text = await fsp.readFile(metaPath, 'utf8')
    unityGuid = parseUnityMetaGuid(text)
    unityMetaName = path.basename(metaPath)
  } catch {
    /* no sibling .meta */
  }

  return describeUvwBuffer(buf, { fileSize, unityGuid, unityMetaName })
}
