import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { mediaUrlFor } from '../media/protocol'
import { protocolAllowlist } from '../security/paths'
import { requireAbsolute } from '../fs/list'
import { resolveVidThumbFrames } from './vidCache'
import { isEditableImagePath } from '@shared/imageEdit'

const THUMB_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'jfif',
  'webp',
  'gif',
  'bmp',
  'avif',
  'tiff',
  'tif',
  'tga',
  'hdr',
  'psd'
])
const VALID_SIZES = [64, 96, 128, 192, 256, 512]

let thumbsDir: string | null = null
const inFlight = new Map<string, Promise<string | null>>()

export function thumbCacheDir(): string {
  if (!thumbsDir) {
    thumbsDir = path.join(app.getPath('userData'), 'thumbs')
    protocolAllowlist.allowDirPermanently(thumbsDir)
  }
  return thumbsDir
}

export async function clearThumbCache(): Promise<void> {
  const dir = thumbCacheDir()
  await fsp.rm(dir, { recursive: true, force: true })
  await fsp.mkdir(dir, { recursive: true })
  const { clearShellIconCache } = await import('../icons/shell')
  await clearShellIconCache()
  const { clearColumnMetaCache } = await import('../meta/columns')
  await clearColumnMetaCache()
  const { clearMediaScratch } = await import('../media/protocol')
  await clearMediaScratch()
  const { clearSessionTempDirs } = await import('../sessionTemp')
  await clearSessionTempDirs(app.getPath('userData'))
}

function nearestSize(requested: number): number {
  for (const s of VALID_SIZES) if (requested <= s) return s
  return VALID_SIZES[VALID_SIZES.length - 1]!
}

export function isThumbable(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return THUMB_EXTS.has(ext)
}

async function mediaCoverThumbUrl(file: string): Promise<string | null> {
  try {
    const { getSettings } = await import('../settings/store')
    if (!getSettings().mediaMetadata.enabled || process.platform !== 'win32') return null
    const { MEDIA_METADATA_THUMB_ADS } = await import('@shared/mediaMetadata')
    const { streamExists, readStreamBytes } = await import('../fs/adsWin32')
    if (!streamExists(file, MEDIA_METADATA_THUMB_ADS)) return null
    const buf = await readStreamBytes(file, MEDIA_METADATA_THUMB_ADS)
    if (!buf || buf.length < 32) return null
    const key = crypto.createHash('sha1').update(buf).digest('hex')
    const ext =
      buf[0] === 0x89 && buf[1] === 0x50
        ? '.png'
        : buf[0] === 0x52 && buf[1] === 0x49
          ? '.webp'
          : '.jpg'
    const cacheFile = path.join(thumbCacheDir(), `mm-${key}${ext}`)
    try {
      await fsp.access(cacheFile)
    } catch {
      await fsp.writeFile(cacheFile, buf)
    }
    return mediaUrlFor(cacheFile)
  } catch {
    return null
  }
}

export async function getThumbUrl(
  rawPath: string,
  size: number
): Promise<{ url: string | null; frames?: string[] }> {
  const file = requireAbsolute(rawPath)

  const { isMediaMetadataVideoName } = await import('@shared/mediaMetadata')
  if (isMediaMetadataVideoName(file)) {
    try {
      const { getSettings } = await import('../settings/store')
      if (getSettings().mediaMetadata.enabled && process.platform === 'win32') {
        const { readMediaMetadata } = await import('../mediaMetadata/store')
        const meta = await readMediaMetadata(file)
        if (meta?.kind === 'episode') {
          const frames = await resolveVidThumbFrames(file)
          return frames.length > 0 ? { url: frames[0]!, frames } : { url: null }
        }
      }
    } catch {
      /* fall through to cover / strip */
    }
  }

  const cover = await mediaCoverThumbUrl(file)
  if (cover) return { url: cover }

  const frames = await resolveVidThumbFrames(file)
  if (frames.length > 0) {
    return { url: frames[0]!, frames }
  }

  if (!isThumbable(file)) return { url: null }

  let st
  try {
    st = await fsp.stat(file)
  } catch {
    return { url: null }
  }
  if (!st.isFile()) return { url: null }

  let tipAds: string | null = null
  let tipOpenPath = file
  let tipSize = st.size
  let tipVer = 0
  if (isEditableImagePath(file) && process.platform === 'win32') {
    try {
      const { resolveImageAdsStream } = await import('../fs/imageEdit')
      const resolved = await resolveImageAdsStream(file)
      tipAds = resolved.ads
      tipOpenPath = resolved.openPath
      tipVer = resolved.versionCount
      try {
        const sst = await fsp.stat(tipOpenPath)
        tipSize = sst.size
      } catch {
        /* keep default size */
      }
    } catch {
      /* tip = $DATA */
    }
  }

  const target = nearestSize(size)
  const key = crypto
    .createHash('sha1')
    .update(
      `${file.toLowerCase()}|${st.mtimeMs}|${st.size}|v${tipVer}|${tipAds ?? 'data'}|${tipSize}|${target}`
    )
    .digest('hex')
  const cacheFile = path.join(thumbCacheDir(), `${key}.webp`)

  try {
    await fsp.access(cacheFile)
    return { url: mediaUrlFor(cacheFile) }
  } catch {
    // not cached yet
  }

  const pending = inFlight.get(key)
  if (pending) {
    const result = await pending
    return { url: result }
  }

  const job = (async (): Promise<string | null> => {
    try {
      const { default: sharp } = await import('sharp')
      await fsp.mkdir(thumbCacheDir(), { recursive: true })
      const tmp = cacheFile + '.tmp'
      const ext = path.extname(file).slice(1).toLowerCase()
      let input: Buffer
      if (ext === 'psd') {
        const { rasterizePsd } = await import('../preview/psd')
        const raster = await rasterizePsd(file, [])
        if (!raster) return null
        input = await fsp.readFile(raster.cachePath)
      } else if (ext === 'tif' || ext === 'tiff' || ext === 'tga' || ext === 'hdr') {
        const { rasterizeWebImage } = await import('../preview/rasterWebImage')
        const raster = await rasterizeWebImage(tipOpenPath)
        if (!raster) return null
        input = await fsp.readFile(raster.cachePath)
      } else {
        // Buffer so sharp does not hold the browsed file open on Windows.
        input = await fsp.readFile(tipOpenPath)
      }
      await sharp(input, { failOn: 'none', limitInputPixels: 512 * 1024 * 1024 })
        .rotate()
        .resize(target, target, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(tmp)
      await fsp.rename(tmp, cacheFile)
      return mediaUrlFor(cacheFile)
    } catch {
      return null
    } finally {
      inFlight.delete(key)
    }
  })()
  inFlight.set(key, job)
  return { url: await job }
}
