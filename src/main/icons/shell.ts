import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { app } from 'electron'
import { mediaUrlFor } from '../media/protocol'
import { protocolAllowlist } from '../security/paths'
import { requireAbsolute } from '../fs/list'
import { enqueueShellIconExtract } from './extractQueue'
import { isNetworkHostUnc, isNetworkShareUnc } from '@shared/networkPaths'
import {
  DRIVE_NO_ROOT_DIR,
  DRIVE_REMOTE,
  DRIVE_UNKNOWN
} from '@shared/networkPaths'
import { getDriveTypeWin32 } from '../fs/drives'
import { logMain } from '../logging'

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

/**
 * Whether the shared-by-extension icon cache may be used.
 * Folders must never share with files — especially extensionless names (`_none`),
 * which previously painted a document glyph on tree folders.
 */
export function shouldUseExtIconCache(ext: string, isDirHint?: boolean): boolean {
  if (isDirHint === true) return false
  if (PER_FILE_EXTS.has(ext)) return false
  // Empty ext is shared by folders and extensionless files — only when caller
  // asserts this path is a file.
  if (!ext) return isDirHint === false
  return true
}

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

/** Stable cache key for deferred rich icons (no mtime/stat — those can hang on cloud/maps). */
function deferredRichCacheKey(file: string, px: number): string {
  return crypto.createHash('sha1').update(`deferred|${file.toLowerCase()}|${px}|v1`).digest('hex')
}

/**
 * Paths where live SHGetFileInfo on the UI thread often freezes Electron.
 * Still get rich icons — just via a worker + optional fast placeholder first.
 */
export function isDeferredShellIconPath(file: string, isDirHint?: boolean): boolean {
  if (isDirHint !== true) return false
  const n = file.replace(/\//g, '\\')
  if (isNetworkHostUnc(n) || isNetworkShareUnc(n)) return true
  if (/(?:^|\\)(Dropbox|OneDrive|Google Drive|iCloud Drive)(?:\\|$)/i.test(n)) return true
  const m = /^([a-zA-Z]:)(?:\\|\/|$)/i.exec(n)
  if (!m) return false
  const dt = getDriveTypeWin32(`${m[1]}\\`)
  return dt === DRIVE_REMOTE || dt <= DRIVE_NO_ROOT_DIR || dt === DRIVE_UNKNOWN
}

// —— Deferred rich icon worker (Dropbox / mapped drives) ——

let iconWorker: Worker | null = null
let iconJobId = 0
const iconJobWaiters = new Map<
  number,
  { resolve: (png: Buffer | null) => void; timer: ReturnType<typeof setTimeout> }
>()

function iconWorkerScriptPath(): string {
  const candidates = [
    path.join(app.getAppPath(), 'out', 'main', 'shellIconWorker.js'),
    path.join(path.dirname(process.execPath), 'resources', 'app.asar', 'out', 'main', 'shellIconWorker.js'),
    path.join(__dirname, 'shellIconWorker.js'),
    path.join(__dirname, '..', 'shellIconWorker.js')
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }
  return candidates[0]!
}

function ensureIconWorker(): Worker | null {
  if (process.platform !== 'win32') return null
  if (iconWorker) return iconWorker
  try {
    const w = new Worker(iconWorkerScriptPath())
    w.on('message', (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return
      const m = msg as { id?: number; ok?: boolean; png?: Uint8Array | Buffer }
      if (typeof m.id !== 'number') return
      const waiter = iconJobWaiters.get(m.id)
      if (!waiter) return
      clearTimeout(waiter.timer)
      iconJobWaiters.delete(m.id)
      if (m.ok && m.png) {
        waiter.resolve(Buffer.isBuffer(m.png) ? m.png : Buffer.from(m.png))
      } else {
        waiter.resolve(null)
      }
    })
    w.on('error', (err) => {
      logMain('warn', `shell icon worker error: ${err instanceof Error ? err.message : String(err)}`)
      iconWorker = null
      for (const [id, waiter] of iconJobWaiters) {
        clearTimeout(waiter.timer)
        waiter.resolve(null)
        iconJobWaiters.delete(id)
      }
    })
    w.on('exit', () => {
      iconWorker = null
    })
    iconWorker = w
    return w
  } catch (e) {
    logMain(
      'warn',
      `shell icon worker failed to start: ${e instanceof Error ? e.message : String(e)}`
    )
    return null
  }
}

/** Extract a rich shell PNG off the UI thread (15s cap). */
function extractRichIconInWorker(file: string, px: 16 | 32): Promise<Buffer | null> {
  const w = ensureIconWorker()
  if (!w) return Promise.resolve(null)
  const id = ++iconJobId
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      iconJobWaiters.delete(id)
      resolve(null)
    }, 15_000)
    iconJobWaiters.set(id, { resolve, timer })
    try {
      w.postMessage({ id, file, px })
    } catch {
      clearTimeout(timer)
      iconJobWaiters.delete(id)
      resolve(null)
    }
  })
}

async function readDeferredRichUrl(file: string, px: 16 | 32): Promise<string | null> {
  const key = deferredRichCacheKey(file, px)
  const cacheFile = path.join(shellIconCacheDir(), `${key}.png`)
  try {
    await fsp.access(cacheFile)
    return mediaUrlFor(cacheFile)
  } catch {
    return null
  }
}

async function writeDeferredRichUrl(file: string, px: 16 | 32, png: Buffer): Promise<string> {
  const key = deferredRichCacheKey(file, px)
  const cacheFile = path.join(shellIconCacheDir(), `${key}.png`)
  await fsp.mkdir(shellIconCacheDir(), { recursive: true })
  const tmp = cacheFile + '.tmp'
  await fsp.writeFile(tmp, png)
  await fsp.rename(tmp, cacheFile)
  return mediaUrlFor(cacheFile)
}

/** Fill deferred rich cache in the background (does not block the caller). */
function scheduleDeferredRichExtract(file: string, px: 16 | 32): void {
  const flightKey = `deferred|${file.toLowerCase()}|${px}`
  if (inFlight.has(flightKey)) return
  const job = (async (): Promise<string | null> => {
    try {
      const existing = await readDeferredRichUrl(file, px)
      if (existing) return existing
      const png = await extractRichIconInWorker(file, px)
      if (!png) return null
      return await writeDeferredRichUrl(file, px, png)
    } catch {
      return null
    } finally {
      inFlight.delete(flightKey)
    }
  })()
  inFlight.set(flightKey, job)
}

async function resolveDeferredRichIcon(
  file: string,
  px: 16 | 32,
  opts?: { fast?: boolean }
): Promise<{ url: string | null; pendingRich?: boolean }> {
  const cached = await readDeferredRichUrl(file, px)
  if (cached) return { url: cached }

  if (opts?.fast === true) {
    scheduleDeferredRichExtract(file, px)
    const attr = await getAttributeIconUrl(file, px, 'dir', '')
    return { url: attr.url, pendingRich: true }
  }

  // Await worker enrich (UI stays responsive — work is off-thread).
  const flightKey = `deferred|${file.toLowerCase()}|${px}`
  let job = inFlight.get(flightKey)
  if (!job) {
    scheduleDeferredRichExtract(file, px)
    job = inFlight.get(flightKey)
  }
  const url = job ? await job : null
  if (url) return { url }
  const attr = await getAttributeIconUrl(file, px, 'dir', '')
  return { url: attr.url }
}

async function encodePng(rgba: Buffer, px: number): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  return sharp(rgba, { raw: { width: px, height: px, channels: 4 } }).png().toBuffer()
}

async function extractPng(
  file: string,
  px: 16 | 32,
  kindHint?: 'file' | 'dir'
): Promise<Buffer | null> {
  // Prefer SHGetFileInfo — Electron's app.getFileIcon often returns the same
  // system-drive glyph for every path on current Windows/Electron builds.
  if (process.platform === 'win32') {
    try {
      const { extractShellIconRgba } = await import('./shellWin32')
      const rgba = extractShellIconRgba(file, px, kindHint)
      if (rgba) {
        const side = Math.round(Math.sqrt(rgba.length / 4))
        return encodePng(rgba, side > 0 ? side : px)
      }
    } catch {
      // fall through
    }
  }
  // app.getFileIcon needs a real path; skip for attribute-only probes.
  if (kindHint) return null
  try {
    const image = await app.getFileIcon(file, { size: px <= 16 ? 'small' : 'normal' })
    if (image.isEmpty()) return null
    return image.resize({ width: px, height: px, quality: 'best' }).toPNG()
  } catch {
    return null
  }
}

/** Cache + extract a type icon for a path that may not exist (SHGFI_USEFILEATTRIBUTES). */
async function getAttributeIconUrl(
  file: string,
  px: 16 | 32,
  kindHint: 'file' | 'dir',
  ext: string
): Promise<{ url: string | null }> {
  const perFile = kindHint === 'dir' || PER_FILE_EXTS.has(ext)
  // After excluding dirs, remaining hits are file-type icons (isDirHint false).
  if (!perFile && shouldUseExtIconCache(ext, false)) {
    const extKey = `${ext || '_none'}|${px}`
    const hit = extUrlCache.get(extKey)
    if (hit) return { url: hit }
  }
  // Stable cache key — not path-mtime based (file may not exist).
  const key = crypto
    .createHash('sha1')
    .update(
      kindHint === 'dir' ? `attr|dir|${px}|v3` : `attr|e|${ext || '_none'}|${px}|v3`
    )
    .digest('hex')
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

  const job = enqueueShellIconExtract(async () => {
    try {
      await fsp.mkdir(shellIconCacheDir(), { recursive: true })
      const png = await extractPng(file, px, kindHint)
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
  })
  inFlight.set(key, job)
  return { url: await job }
}

/**
 * Shell icon for a path — on Windows this uses SHGetFileInfo (Explorer-accurate:
 * Downloads / Documents special icons, Dropbox desktop.ini, exe/lnk overlays).
 * Cached under userData and served via mfe-media://.
 *
 * @param isDirHint — from the renderer (tree/list already know kind). Required to
 *   keep folder icons out of the shared extension cache.
 * @param opts.fast — for deferred paths (Dropbox / mapped drives): return a type
 *   icon immediately and set `pendingRich` so the renderer can upgrade async.
 */
export async function getShellIconUrl(
  rawPath: string,
  sizePx: number,
  isDirHint?: boolean,
  opts?: { fast?: boolean }
): Promise<{ url: string | null; pendingRich?: boolean }> {
  const file = requireAbsolute(rawPath)
  const kind = mapSize(sizePx)
  const px = pixelSize(kind)
  const ext = path.extname(file).slice(1).toLowerCase()

  // Extension icons are shared (all .png → one glyph). Hit memory cache before
  // any disk IO — critical when a virtualized details view mounts dozens of rows.
  // Never for folders / unknown extensionless paths (see shouldUseExtIconCache).
  if (shouldUseExtIconCache(ext, isDirHint)) {
    const extKey = `${ext || '_none'}|${px}`
    const hit = extUrlCache.get(extKey)
    if (hit) return { url: hit }
  }

  // Dropbox / OneDrive / mapped Z: — never SHGetFileInfo on the UI thread.
  // fast → placeholder + background worker; otherwise await worker enrich.
  if (isDeferredShellIconPath(file, isDirHint)) {
    return resolveDeferredRichIcon(file, px, opts)
  }

  // Opt-in attribute-only (tests / probes).
  if (opts?.fast === true && isDirHint === true) {
    return getAttributeIconUrl(file, px, 'dir', ext)
  }

  let st
  try {
    st = await fsp.stat(file)
  } catch {
    // Missing path: still resolve Explorer type icons (New menu probes, etc.).
    if (isDirHint === true) return getAttributeIconUrl(file, px, 'dir', ext)
    if (ext) return getAttributeIconUrl(file, px, 'file', ext)
    return { url: null }
  }

  const isDir = st.isDirectory()
  const perFile = isDir || PER_FILE_EXTS.has(ext)
  if (!perFile && shouldUseExtIconCache(ext, false)) {
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

  const job = enqueueShellIconExtract(async () => {
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
  })

  inFlight.set(key, job)
  return { url: await job }
}
