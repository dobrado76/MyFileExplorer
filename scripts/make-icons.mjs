/**
 * Builds the app icons from resources/icon.png:
 *   - rounds the corners to transparency (in place, idempotent)
 *   - writes build/icon.ico (multi-size, PNG-compressed entries)
 *
 * Run with: npm run icons
 */
import { Buffer } from 'node:buffer'
import console from 'node:console'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = path.resolve(import.meta.dirname, '..')
const SOURCE = path.join(ROOT, 'resources', 'icon.png')
const ICO_OUT = path.join(ROOT, 'build', 'icon.ico')
const ICO_SIZES = [256, 128, 64, 48, 32, 24, 16]
const CORNER_RADIUS_RATIO = 0.25

async function roundCorners() {
  const img = sharp(await readFile(SOURCE))
  const { width, height } = await img.metadata()
  const size = Math.min(width, height)
  const r = Math.round(size * CORNER_RADIUS_RATIO)
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
  )
  const rounded = await img
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
  await writeFile(SOURCE, rounded)
  return rounded
}

/** ICO container with PNG-encoded images (supported since Windows Vista). */
function buildIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(pngs.length, 4)

  const entries = []
  const blobs = []
  let offset = 6 + 16 * pngs.length
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1) // height
    e.writeUInt8(0, 2) // palette colors
    e.writeUInt8(0, 3) // reserved
    e.writeUInt16LE(1, 4) // color planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    blobs.push(data)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...blobs])
}

const master = await roundCorners()
const pngs = []
for (const size of ICO_SIZES) {
  const data = await sharp(master).resize(size, size, { fit: 'contain' }).png().toBuffer()
  pngs.push({ size, data })
}
await mkdir(path.dirname(ICO_OUT), { recursive: true })
await writeFile(ICO_OUT, buildIco(pngs))
console.log(`Wrote ${ICO_OUT} (${ICO_SIZES.join(', ')} px) and rounded ${SOURCE}`)
