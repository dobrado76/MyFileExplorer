import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { readPsd, type Layer, type Psd } from 'ag-psd'
import { mediaUrlFor } from '../media/protocol'
import { protocolAllowlist } from '../security/paths'

const MAX_FILE_BYTES = 200 * 1024 * 1024
const MAX_PIXELS = 40_000_000

let cacheDir: string | null = null

function psdCacheDir(): string {
  if (!cacheDir) {
    cacheDir = path.join(app.getPath('userData'), 'psd-preview')
    protocolAllowlist.allowDirPermanently(cacheDir)
  }
  return cacheDir
}

function countLayers(children: Layer[] | undefined): number {
  if (!children?.length) return 0
  let n = 0
  for (const c of children) {
    n++
    if (c.children) n += countLayers(c.children)
  }
  return n
}

export type PsdRaster = {
  /** Absolute path to the cached PNG (also exposed via mediaUrl). */
  cachePath: string
  mediaUrl: string
  width: number
  height: number
  layerCount: number
  fromThumbnail: boolean
}

/**
 * Rasterize a PSD for preview: prefer the embedded JPEG thumbnail (fast),
 * else decode the composite imageData with sharp (no node-canvas).
 * Result PNG is cached under userData.
 */
export async function rasterizePsd(file: string, warnings: string[]): Promise<PsdRaster | null> {
  let st
  try {
    st = await fsp.stat(file)
  } catch {
    warnings.push('Could not read PSD')
    return null
  }
  if (st.size > MAX_FILE_BYTES) {
    warnings.push('PSD too large to preview')
    return null
  }

  const key = crypto
    .createHash('sha1')
    .update(`${file.toLowerCase()}|${st.mtimeMs}|${st.size}`)
    .digest('hex')
  const dir = psdCacheDir()
  await fsp.mkdir(dir, { recursive: true })
  const cacheFile = path.join(dir, `${key}.png`)

  const { default: sharp } = await import('sharp')

  const metaFile = `${cacheFile}.json`
  try {
    await fsp.access(cacheFile)
    let width = 0
    let height = 0
    let layerCount = 0
    let fromThumbnail = true
    try {
      const saved = JSON.parse(await fsp.readFile(metaFile, 'utf8')) as {
        width?: number
        height?: number
        layerCount?: number
        fromThumbnail?: boolean
      }
      width = saved.width ?? 0
      height = saved.height ?? 0
      layerCount = saved.layerCount ?? 0
      fromThumbnail = saved.fromThumbnail ?? true
    } catch {
      const m = await sharp(cacheFile).metadata()
      width = m.width ?? 0
      height = m.height ?? 0
    }
    return {
      cachePath: cacheFile,
      mediaUrl: mediaUrlFor(cacheFile),
      width,
      height,
      layerCount,
      fromThumbnail
    }
  } catch {
    // not cached
  }

  const buf = await fsp.readFile(file)
  let png: Buffer | null = null
  let width = 0
  let height = 0
  let layerCount = 0
  let fromThumbnail = false

  // Fast path: embedded thumbnail (what Explorer/Bridge show).
  try {
    const thumbPsd = readPsd(buf, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      useRawThumbnail: true,
      skipLinkedFilesData: true
    })
    width = thumbPsd.width
    height = thumbPsd.height
    layerCount = countLayers(thumbPsd.children)
    const raw = thumbPsd.imageResources?.thumbnailRaw
    if (raw?.data?.length) {
      png = await sharp(Buffer.from(raw.data)).png().toBuffer()
      fromThumbnail = true
    }
  } catch (e) {
    warnings.push(e instanceof Error ? `PSD thumbnail: ${e.message}` : 'PSD thumbnail failed')
  }

  // Fallback: full composite as raw RGBA → PNG.
  if (!png) {
    try {
      const psd: Psd = readPsd(buf, {
        skipLayerImageData: true,
        skipThumbnail: true,
        useImageData: true,
        skipLinkedFilesData: true
      })
      width = psd.width
      height = psd.height
      layerCount = countLayers(psd.children)
      if (width * height > MAX_PIXELS) {
        warnings.push('PSD composite too large to decode')
        return null
      }
      const img = psd.imageData
      if (!img?.data) {
        warnings.push(
          'No embedded preview — in Photoshop use File → Save As with “Maximize Compatibility”'
        )
        return null
      }
      const pixels = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength)
      png = await sharp(pixels, {
        raw: { width: img.width, height: img.height, channels: 4 }
      })
        .png()
        .toBuffer()
      fromThumbnail = false
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : 'Could not decode PSD')
      return null
    }
  }

  const tmp = cacheFile + '.tmp'
  await fsp.writeFile(tmp, png)
  await fsp.rename(tmp, cacheFile)
  await fsp.writeFile(
    metaFile,
    JSON.stringify({ width, height, layerCount, fromThumbnail }),
    'utf8'
  )
  return {
    cachePath: cacheFile,
    mediaUrl: mediaUrlFor(cacheFile),
    width,
    height,
    layerCount,
    fromThumbnail
  }
}
