import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { mediaUrlFor } from '../media/protocol'
import { protocolAllowlist } from '../security/paths'
import { requireAbsolute } from '../fs/list'

/** Extensions whose icon is embedded / per-file (not shared by type). */
const PER_FILE_EXTS = new Set([
  'exe',
  'lnk',
  'ico',
  'dll',
  'scr',
  'cpl',
  'msi',
  'appx',
  'msix',
  'msc'
])

let iconsDir: string | null = null
const inFlight = new Map<string, Promise<string | null>>()
/** Reuse one extracted icon URL for all files of the same extension. */
const extUrlCache = new Map<string, string>()

export function shellIconCacheDir(): string {
  if (!iconsDir) {
    iconsDir = path.join(app.getPath('userData'), 'shell-icons')
    protocolAllowlist.allowDirPermanently(iconsDir)
  }
  return iconsDir
}

export async function clearShellIconCache(): Promise<void> {
  const dir = shellIconCacheDir()
  await fsp.rm(dir, { recursive: true, force: true })
  await fsp.mkdir(dir, { recursive: true })
  extUrlCache.clear()
  inFlight.clear()
}

export type ShellIconSize = 'small' | 'normal'

function mapSize(px: number): ShellIconSize {
  return px <= 20 ? 'small' : 'normal'
}

function pixelSize(kind: ShellIconSize): 16 | 32 {
  return kind === 'small' ? 16 : 32
}

async function folderStamp(dir: string, stMtimeMs: number): Promise<string> {
  // desktop.ini drives Explorer custom icons (Dropbox, user-customized folders).
  let ini = 0
  try {
    ini = (await fsp.stat(path.join(dir, 'desktop.ini'))).mtimeMs
  } catch {
    // none
  }
  return `${stMtimeMs}|${ini}`
}

function cacheKey(file: string, stamp: string, isDir: boolean, kind: ShellIconSize): string {
  const ext = path.extname(file).slice(1).toLowerCase()
  const px = pixelSize(kind)
  if (isDir || PER_FILE_EXTS.has(ext)) {
    return crypto
      .createHash('sha1')
      .update(`p|${file.toLowerCase()}|${stamp}|${px}|v3`)
      .digest('hex')
  }
  return crypto.createHash('sha1').update(`e|${ext || '_none'}|${px}|v3`).digest('hex')
}

async function encodePng(rgba: Buffer, px: number): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  return sharp(rgba, { raw: { width: px, height: px, channels: 4 } }).png().toBuffer()
}

async function extractPng(file: string, px: 16 | 32): Promise<Buffer | null> {
  // Prefer SHGetFileInfo — Electron's app.getFileIcon often returns the same
  // system-drive glyph for every path on current Windows/Electron builds.
  if (process.platform === 'win32') {
    try {
      const { extractShellIconRgba } = await import('./shellWin32')
      const rgba = extractShellIconRgba(file, px)
      if (rgba) {
        const side = Math.round(Math.sqrt(rgba.length / 4))
        return encodePng(rgba, side > 0 ? side : px)
      }
    } catch {
      // fall through
    }
  }
  try {
    const image = await app.getFileIcon(file, { size: px <= 16 ? 'small' : 'normal' })
    if (image.isEmpty()) return null
    return image.resize({ width: px, height: px, quality: 'best' }).toPNG()
  } catch {
    return null
  }
}

/**
 * Shell icon for a path — on Windows this uses SHGetFileInfo (Explorer-accurate:
 * Downloads / Documents special icons, Dropbox desktop.ini, exe/lnk overlays).
 * Cached under userData and served via mfe-media://.
 */
export async function getShellIconUrl(
  rawPath: string,
  sizePx: number
): Promise<{ url: string | null }> {
  const file = requireAbsolute(rawPath)
  const kind = mapSize(sizePx)
  const px = pixelSize(kind)
  const ext = path.extname(file).slice(1).toLowerCase()

  // Extension icons are shared (all .png → one glyph). Hit memory cache before
  // any disk IO — critical when a virtualized details view mounts dozens of rows.
  if (!PER_FILE_EXTS.has(ext)) {
    const extKey = `${ext || '_none'}|${px}`
    const hit = extUrlCache.get(extKey)
    if (hit) return { url: hit }
  }

  let st
  try {
    st = await fsp.stat(file)
  } catch {
    return { url: null }
  }

  const isDir = st.isDirectory()
  const perFile = isDir || PER_FILE_EXTS.has(ext)
  if (!perFile) {
    const extKey = `${ext || '_none'}|${px}`
    const hit = extUrlCache.get(extKey)
    if (hit) return { url: hit }
  }

  const stamp = isDir ? await folderStamp(file, st.mtimeMs) : String(st.mtimeMs)
  const key = cacheKey(file, stamp, isDir, kind)
  const cacheFile = path.join(shellIconCacheDir(), `${key}.png`)

  try {
    await fsp.access(cacheFile)
    const url = mediaUrlFor(cacheFile)
    if (!perFile) extUrlCache.set(`${ext || '_none'}|${px}`, url)
    return { url }
  } catch {
    // generate
  }

  const pending = inFlight.get(key)
  if (pending) return { url: await pending }

  const job = (async (): Promise<string | null> => {
    try {
      await fsp.mkdir(shellIconCacheDir(), { recursive: true })
      const png = await extractPng(file, px)
      if (!png) return null
      const tmp = cacheFile + '.tmp'
      await fsp.writeFile(tmp, png)
      await fsp.rename(tmp, cacheFile)
      const url = mediaUrlFor(cacheFile)
      if (!perFile) extUrlCache.set(`${ext || '_none'}|${px}`, url)
      return url
    } catch {
      return null
    } finally {
      inFlight.delete(key)
    }
  })()

  inFlight.set(key, job)
  return { url: await job }
}
