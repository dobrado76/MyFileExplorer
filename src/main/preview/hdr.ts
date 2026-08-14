/**
 * Radiance RGBE / XYZE (`.hdr`) — header parse + tonemapped RGBA for preview.
 * Chromium cannot paint Radiance; Sharp prebuilts often omit radload.
 */

import type { PreviewField } from '@shared/schemas/preview'

export const HDR_HEADER_SNIFF = 16 * 1024
const MAX_DIM = 16384
const MAX_OUT_EDGE = 8192
/** Source pixel cap (16K equirect ≈ 134M). Output is subsampled to MAX_OUT_EDGE. */
const MAX_SOURCE_PIXELS = 256 * 1024 * 1024

export type HdrFormat = 'rgbe' | 'xyze'

export type HdrHeader = {
  magic: 'RADIANCE' | 'RGBE'
  format: HdrFormat
  width: number
  height: number
  exposure: number
  gamma: number | null
  comments: string[]
  vars: Record<string, string>
  orientation: string
  dataOffset: number
}

export type HdrRgba = {
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  scale: number
  rgba: Buffer
  header: HdrHeader
}

type Axis = { axis: 'x' | 'y'; sign: 1 | -1; size: number }

export function parseHdrHeader(buf: Buffer): HdrHeader | null {
  if (buf.length < 12) return null
  const peek = buf.subarray(0, Math.min(buf.length, 16)).toString('latin1')
  let magic: 'RADIANCE' | 'RGBE'
  if (peek.startsWith('#?RADIANCE')) magic = 'RADIANCE'
  else if (peek.startsWith('#?RGBE')) magic = 'RGBE'
  else return null

  const limit = Math.min(buf.length, HDR_HEADER_SNIFF)
  let i = 0
  const comments: string[] = []
  const vars: Record<string, string> = {}
  let sawBlank = false

  while (i < limit) {
    const nl = buf.indexOf(0x0a, i)
    if (nl < 0 || nl >= limit) return null
    const line = buf.toString('latin1', i, nl).replace(/\r$/, '')
    i = nl + 1
    if (line === '') {
      sawBlank = true
      break
    }
    if (line.startsWith('#')) {
      const rest = line.slice(1).trim()
      if (rest && !rest.startsWith('?')) comments.push(rest.slice(0, 120))
      continue
    }
    const eq = line.indexOf('=')
    if (eq > 0) {
      const key = line.slice(0, eq).trim()
      const val = line.slice(eq + 1).trim()
      if (key) vars[key.toUpperCase()] = val
    }
  }
  if (!sawBlank || i >= buf.length) return null

  const nl = buf.indexOf(0x0a, i)
  if (nl < 0) return null
  const orientation = buf.toString('latin1', i, nl).replace(/\r$/, '').trim()
  const dataOffset = nl + 1

  const axes = parseOrientation(orientation)
  if (!axes) return null
  const width = axes.x.size
  const height = axes.y.size
  if (width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) return null
  if (width * height > MAX_SOURCE_PIXELS) return null

  const fmtRaw = (vars.FORMAT ?? '').toLowerCase()
  let format: HdrFormat
  if (fmtRaw.includes('xyze')) format = 'xyze'
  else if (fmtRaw.includes('rgbe') || fmtRaw === '') format = 'rgbe'
  else return null

  const exposure = Number.parseFloat(vars.EXPOSURE ?? '1')
  const gammaRaw = vars.GAMMA != null ? Number.parseFloat(vars.GAMMA) : NaN

  return {
    magic,
    format,
    width,
    height,
    exposure: Number.isFinite(exposure) && exposure > 0 ? exposure : 1,
    gamma: Number.isFinite(gammaRaw) && gammaRaw > 0 ? gammaRaw : null,
    comments: comments.slice(0, 6),
    vars,
    orientation,
    dataOffset
  }
}

function parseOrientation(line: string): { x: Axis; y: Axis } | null {
  const m = line.match(/^([+-])([XY])\s+(\d+)\s+([+-])([XY])\s+(\d+)$/i)
  if (!m) return null
  const a: Axis = {
    axis: m[2]!.toLowerCase() as 'x' | 'y',
    sign: m[1] === '+' ? 1 : -1,
    size: Number.parseInt(m[3]!, 10)
  }
  const b: Axis = {
    axis: m[5]!.toLowerCase() as 'x' | 'y',
    sign: m[4] === '+' ? 1 : -1,
    size: Number.parseInt(m[6]!, 10)
  }
  if (a.axis === b.axis || !Number.isFinite(a.size) || !Number.isFinite(b.size)) return null
  const x = a.axis === 'x' ? a : b
  const y = a.axis === 'y' ? a : b
  return { x, y }
}

export function hdrLayoutHint(width: number, height: number): string | null {
  if (width < 2 || height < 1) return null
  const r = width / height
  if (r >= 1.9 && r <= 2.1) return 'Equirectangular (typical HDRI / skybox)'
  if (r >= 0.47 && r <= 0.53) return 'Equirectangular (1:2)'
  if (Math.abs(r - 4 / 3) < 0.04) return 'Possible cube cross (4:3)'
  if (Math.abs(r - 3 / 4) < 0.04) return 'Possible cube cross (3:4)'
  if (Math.abs(r - 6) < 0.2) return 'Possible cube strip (6:1)'
  return null
}

function field(id: string, label: string, value: string, copyable = false): PreviewField {
  return { id, label, value, group: 'other', copyable }
}

export function hdrPreviewFields(
  header: HdrHeader,
  extra?: { unityGuid?: string | null; unityMetaName?: string | null; scale?: number }
): PreviewField[] {
  const fields: PreviewField[] = [
    field('hdr.format', 'Format', `Radiance ${header.format.toUpperCase()} (${header.magic})`),
    field(
      'hdr.usedAs',
      'Typical use',
      'HDRI environment / IBL / skybox. Not a 3D mesh — a 2D latitude-longitude (or cube) map.'
    )
  ]
  const layout = hdrLayoutHint(header.width, header.height)
  if (layout) fields.push(field('hdr.layout', 'Layout', layout))
  if (header.exposure !== 1) {
    fields.push(field('hdr.exposure', 'Exposure', String(header.exposure)))
  }
  if (header.gamma != null) {
    fields.push(field('hdr.gamma', 'Gamma', String(header.gamma)))
  }
  if (header.orientation) {
    fields.push(field('hdr.orientation', 'Orientation', header.orientation))
  }
  if (extra?.scale && extra.scale > 1) {
    fields.push(
      field(
        'hdr.previewScale',
        'Preview',
        `Tonemapped 1/${extra.scale} (${header.width} × ${header.height} source)`
      )
    )
  }
  const software = header.vars.SOFTWARE
  if (software) fields.push(field('hdr.software', 'Software', software.slice(0, 160), true))
  for (const c of header.comments) {
    if (software && c.toLowerCase().includes(software.toLowerCase())) continue
    fields.push(field(`hdr.comment.${fields.length}`, 'Comment', c, true))
  }
  if (extra?.unityGuid) fields.push(field('hdr.unityGuid', 'Unity GUID', extra.unityGuid, true))
  if (extra?.unityMetaName) {
    fields.push(field('hdr.unityMeta', 'Unity sidecar', extra.unityMetaName, true))
  }
  return fields
}

export function unknownHdrFields(): PreviewField[] {
  return [
    field('hdr.format', 'Format', 'Unknown .hdr (not Radiance RGBE)'),
    field(
      'hdr.note',
      'Note',
      'No #?RADIANCE / #?RGBE header. Other uses of .hdr include Analyze 7.5 medical headers (companion to .img).'
    )
  ]
}

function rgbeToLinear(r: number, g: number, b: number, e: number): [number, number, number] {
  if (e === 0) return [0, 0, 0]
  const f = Math.pow(2, e - 128) / 255
  return [r * f, g * f, b * f]
}

function xyzToRgb(x: number, y: number, z: number): [number, number, number] {
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z
  ]
}

function tonemap(v: number, exposure: number): number {
  const x = Math.max(0, v * exposure)
  const t = x / (1 + x)
  return Math.round(Math.min(1, Math.pow(t, 1 / 2.2)) * 255)
}

function readNewRleScanline(
  buf: Buffer,
  pos: number,
  width: number
): { scan: Buffer; pos: number } | null {
  if (pos + 4 > buf.length) return null
  const wHi = buf[pos + 2]!
  const wLo = buf[pos + 3]!
  if (buf[pos] !== 2 || buf[pos + 1] !== 2 || ((wHi << 8) | wLo) !== width) return null
  pos += 4
  const scan = Buffer.alloc(width * 4)
  for (let ch = 0; ch < 4; ch++) {
    let x = 0
    while (x < width) {
      if (pos >= buf.length) return null
      const code = buf[pos++]!
      if (code > 128) {
        const run = code - 128
        if (pos >= buf.length || x + run > width) return null
        const val = buf[pos++]!
        for (let k = 0; k < run; k++) {
          scan[x * 4 + ch] = val
          x++
        }
      } else {
        if (pos + code > buf.length || x + code > width) return null
        for (let k = 0; k < code; k++) {
          scan[x * 4 + ch] = buf[pos++]!
          x++
        }
      }
    }
  }
  return { scan, pos }
}

function readOldScanline(
  buf: Buffer,
  pos: number,
  width: number
): { scan: Buffer; pos: number } | null {
  const scan = Buffer.alloc(width * 4)
  let x = 0
  while (x < width) {
    if (pos + 4 > buf.length) return null
    const r = buf[pos]!
    const g = buf[pos + 1]!
    const b = buf[pos + 2]!
    const e = buf[pos + 3]!
    pos += 4
    if (r === 1 && g === 1 && b === 1) {
      const run = e
      if (run < 1 || x + run > width || x === 0) return null
      const pr = scan[(x - 1) * 4]!
      const pg = scan[(x - 1) * 4 + 1]!
      const pb = scan[(x - 1) * 4 + 2]!
      const pe = scan[(x - 1) * 4 + 3]!
      for (let k = 0; k < run; k++) {
        const o = x * 4
        scan[o] = pr
        scan[o + 1] = pg
        scan[o + 2] = pb
        scan[o + 3] = pe
        x++
      }
    } else {
      const o = x * 4
      scan[o] = r
      scan[o + 1] = g
      scan[o + 2] = b
      scan[o + 3] = e
      x++
    }
  }
  return { scan, pos }
}

function readScanline(
  buf: Buffer,
  pos: number,
  width: number
): { scan: Buffer; pos: number } | null {
  if (width >= 8 && width <= 0x7fff && pos + 4 <= buf.length) {
    const neu = readNewRleScanline(buf, pos, width)
    if (neu) return neu
  }
  return readOldScanline(buf, pos, width)
}

function destXY(
  scanI: number,
  pixI: number,
  scan: Axis,
  pix: Axis,
  width: number,
  height: number
): { x: number; y: number } {
  let x: number
  let y: number
  if (scan.axis === 'y') {
    y = scan.sign < 0 ? scanI : height - 1 - scanI
    x = pix.sign > 0 ? pixI : width - 1 - pixI
  } else {
    x = scan.sign > 0 ? scanI : width - 1 - scanI
    y = pix.sign < 0 ? pixI : height - 1 - pixI
  }
  return { x, y }
}

export function decodeHdr(buf: Buffer): HdrRgba | null {
  const header = parseHdrHeader(buf)
  if (!header) return null
  const axes = parseOrientation(header.orientation)
  if (!axes) return null

  const firstY = header.orientation.toUpperCase().trim().startsWith('-Y') ||
    header.orientation.toUpperCase().trim().startsWith('+Y')
  const scan = firstY ? axes.y : axes.x
  const pix = firstY ? axes.x : axes.y
  const scanCount = scan.size
  const pixCount = pix.size
  const { width, height } = header

  const scale = Math.max(
    1,
    Math.ceil(Math.max(width, height) / MAX_OUT_EDGE)
  )
  const outW = Math.max(1, Math.floor(width / scale))
  const outH = Math.max(1, Math.floor(height / scale))
  const rgba = Buffer.alloc(outW * outH * 4)
  const xyze = header.format === 'xyze'
  const exposure = header.exposure

  let pos = header.dataOffset
  for (let si = 0; si < scanCount; si++) {
    const row = readScanline(buf, pos, pixCount)
    if (!row) return null
    pos = row.pos
    if (si % scale !== 0) continue
    for (let pi = 0; pi < pixCount; pi++) {
      if (pi % scale !== 0) continue
      const { x, y } = destXY(si, pi, scan, pix, width, height)
      const ox = Math.floor(x / scale)
      const oy = Math.floor(y / scale)
      if (ox < 0 || oy < 0 || ox >= outW || oy >= outH) continue
      const r = row.scan[pi * 4]!
      const g = row.scan[pi * 4 + 1]!
      const b = row.scan[pi * 4 + 2]!
      const e = row.scan[pi * 4 + 3]!
      let lin = rgbeToLinear(r, g, b, e)
      if (xyze) lin = xyzToRgb(lin[0], lin[1], lin[2])
      const o = (oy * outW + ox) * 4
      rgba[o] = tonemap(lin[0], exposure)
      rgba[o + 1] = tonemap(lin[1], exposure)
      rgba[o + 2] = tonemap(lin[2], exposure)
      rgba[o + 3] = 255
    }
  }

  return {
    width: outW,
    height: outH,
    sourceWidth: width,
    sourceHeight: height,
    scale,
    rgba,
    header
  }
}

/** Test helper: uncompressed RGBE after a standard `-Y +X` header. */
export function encodeHdrRgbe(
  width: number,
  height: number,
  rgbe: Buffer,
  extraHeader = ''
): Buffer {
  const extra = extraHeader && !extraHeader.endsWith('\n') ? `${extraHeader}\n` : extraHeader
  const head = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n${extra}\n-Y ${height} +X ${width}\n`
  return Buffer.concat([Buffer.from(head, 'ascii'), rgbe])
}
