import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { mediaUrlFor } from '../media/protocol'
import { protocolAllowlist } from '../security/paths'
import { decodeTga } from './tga'
import { decodeHdr } from './hdr'

/** Chromium cannot paint these; rasterize to cached WebP under userData. */
const RASTER_EXTS = new Set(['tif', 'tiff', 'tga', 'hdr'])

const MAX_FILE_BYTES = 512 * 1024 * 1024
const MAX_PIXELS = 512 * 1024 * 1024

let cacheDir: string | null = null

function rasterCacheDir(): string {
  if (!cacheDir) {
    cacheDir = path.join(app.getPath('userData'), 'raster-preview')
    protocolAllowlist.allowDirPermanently(cacheDir)
  }
  return cacheDir
}

export function needsWebRaster(ext: string): boolean {
  return RASTER_EXTS.has(ext.toLowerCase())
}

export type WebRaster = {
  cachePath: string
  mediaUrl: string
  width: number
  height: number
}

/**
 * Decode TIFF / TGA / Radiance HDR and cache a WebP Chromium can show.
 * Used by preview, thumbs, and slideshow (via preview mediaUrl).
 */
export async function rasterizeWebImage(file: string): Promise<WebRaster | null> {
  let st
  try {
    st = await fsp.stat(file)
  } catch {
    return null
  }
  if (!st.isFile() || st.size <= 0 || st.size > MAX_FILE_BYTES) return null

  const key = crypto
    .createHash('sha1')
    .update(`${file.toLowerCase()}|${st.mtimeMs}|${st.size}`)
    .digest('hex')
  const dir = rasterCacheDir()
  await fsp.mkdir(dir, { recursive: true })
  const cacheFile = path.join(dir, `${key}.webp`)
  const metaFile = `${cacheFile}.json`

  try {
    await fsp.access(cacheFile)
    let width = 0
    let height = 0
    try {
      const saved = JSON.parse(await fsp.readFile(metaFile, 'utf8')) as {
        width?: number
        height?: number
      }
      width = saved.width ?? 0
      height = saved.height ?? 0
    } catch {
      /* re-read via sharp below if needed */
    }
    if (width <= 0 || height <= 0) {
      const { default: sharp } = await import('sharp')
      const m = await sharp(cacheFile).metadata()
      width = m.width ?? 0
      height = m.height ?? 0
    }
    return { cachePath: cacheFile, mediaUrl: mediaUrlFor(cacheFile), width, height }
  } catch {
    /* not cached */
  }

  try {
    const { default: sharp } = await import('sharp')
    const input = await fsp.readFile(file)
    const ext = path.extname(file).slice(1).toLowerCase()
    if (ext === 'tga' || ext === 'hdr') {
      const decoded = ext === 'tga' ? decodeTga(input) : decodeHdr(input)
      if (decoded) {
        const tmp = cacheFile + '.tmp'
        await sharp(decoded.rgba, {
          raw: { width: decoded.width, height: decoded.height, channels: 4 }
        })
          .webp({ quality: 88 })
          .toFile(tmp)
        await fsp.rename(tmp, cacheFile)
        await fsp.writeFile(
          metaFile,
          JSON.stringify({ width: decoded.width, height: decoded.height }),
          'utf8'
        )
        return {
          cachePath: cacheFile,
          mediaUrl: mediaUrlFor(cacheFile),
          width: decoded.width,
          height: decoded.height
        }
      }
    }
    const attempts = [
      {
        failOn: 'none' as const,
        unlimited: true,
        limitInputPixels: MAX_PIXELS,
        pages: 1,
        page: 0
      },
      { failOn: 'none' as const, unlimited: true, limitInputPixels: MAX_PIXELS }
    ]
    let width = 0
    let height = 0
    let wrote = false
    const tmp = cacheFile + '.tmp'
    for (const opts of attempts) {
      try {
        const meta = await sharp(input, opts).metadata()
        width = meta.width ?? 0
        height = meta.height ?? 0
        await sharp(input, opts).rotate().toColorspace('srgb').webp({ quality: 88 }).toFile(tmp)
        wrote = true
        break
      } catch {
        /* try next option set (TGA rejects pages:, some TIFF needs it) */
      }
    }
    if (!wrote) return null
    await fsp.rename(tmp, cacheFile)
    await fsp.writeFile(metaFile, JSON.stringify({ width, height }), 'utf8')
    return { cachePath: cacheFile, mediaUrl: mediaUrlFor(cacheFile), width, height }
  } catch {
    return null
  }
}
