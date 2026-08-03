import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { mediaUrlFor } from '../media/protocol'
import { protocolAllowlist } from '../security/paths'
import { requireAbsolute } from '../fs/list'
import { resolveVidThumbFrames } from './vidCache'

const THUMB_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'avif',
  'tiff',
  'tif',
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
}

function nearestSize(requested: number): number {
  for (const s of VALID_SIZES) if (requested <= s) return s
  return VALID_SIZES[VALID_SIZES.length - 1]!
}

export function isThumbable(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return THUMB_EXTS.has(ext)
}

export async function getThumbUrl(
  rawPath: string,
  size: number
): Promise<{ url: string | null; frames?: string[] }> {
  const file = requireAbsolute(rawPath)

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

  const target = nearestSize(size)
  const key = crypto
    .createHash('sha1')
    .update(`${file.toLowerCase()}|${st.mtimeMs}|${st.size}|${target}`)
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
      let input: string | Buffer = file
      if (ext === 'psd') {
        const { rasterizePsd } = await import('../preview/psd')
        const raster = await rasterizePsd(file, [])
        if (!raster) return null
        input = raster.cachePath
      }
      await sharp(input, { failOn: 'truncated', limitInputPixels: 512 * 1024 * 1024 })
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
