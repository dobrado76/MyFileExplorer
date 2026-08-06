/**
 * Serve allowlisted browsed files over mfe-media without leaving the *source*
 * file open in Chromium. Windows Recycle Bin fails when any process holds a
 * handle on the item (or often its parent) — net.fetch(file://) is the usual
 * culprit for video/PDF preview.
 *
 * Strategy:
 * 1. Small/medium files → read fully into memory, respond, close handle.
 * 2. Large files → copy once to userData scratch, serve the scratch (Chromium
 *    may hold the scratch; the user's original is free to recycle).
 */
import { app, protocol, net } from 'electron'
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { protocolAllowlist } from '../security/paths'
import { MODEL_SCHEME } from './modelProtocol'
import { ORT_SCHEME } from './ortProtocol'

export const MEDIA_SCHEME = 'mfe-media'

/** Prefer full buffer so the source fd is closed before Chromium paints. */
const MAX_BUFFER_BYTES = 128 * 1024 * 1024

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  json: 'application/json'
}

/** Must run before app ready. Media + LaMa model/ORT WASM schemes. */
export function registerMediaSchemeAsPrivileged(): void {
  const privileges = {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true
  }
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges },
    { scheme: MODEL_SCHEME, privileges },
    { scheme: ORT_SCHEME, privileges }
  ])
}

/** Extract the requested absolute path from a mfe-media URL, or null. */
export function mediaPathFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== `${MEDIA_SCHEME}:`) return null
    const p = url.searchParams.get('p')
    if (!p) return null
    return p
  } catch {
    return null
  }
}

/**
 * Build a media URL. Optional `cacheKey` (e.g. mtimeMs-size) busts Chromium’s
 * HTTP cache when the file bytes change but the path stays the same — needed
 * after in-place image edits so preview/thumbs don’t keep showing the old image.
 */
export function mediaUrlFor(absPath: string, cacheKey?: number | string): string {
  const base = `${MEDIA_SCHEME}://local/?p=${encodeURIComponent(absPath)}`
  if (cacheKey === undefined || cacheKey === '') return base
  return `${base}&v=${encodeURIComponent(String(cacheKey))}`
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

let scratchDir: string | null = null
const scratchInFlight = new Map<string, Promise<string>>()

function mediaScratchDir(): string {
  if (!scratchDir) {
    scratchDir = path.join(app.getPath('userData'), 'media-scratch')
    protocolAllowlist.allowDirPermanently(scratchDir)
  }
  return scratchDir
}

function scratchKey(filePath: string, mtimeMs: number, size: number): string {
  return crypto
    .createHash('sha1')
    .update(`${filePath.toLowerCase()}|${mtimeMs}|${size}`)
    .digest('hex')
}

/** Copy source → userData scratch (once per path+mtime+size). Source closes after copy. */
async function ensureScratchCopy(
  filePath: string,
  mtimeMs: number,
  size: number
): Promise<string> {
  const key = scratchKey(filePath, mtimeMs, size)
  const ext = path.extname(filePath) || '.bin'
  const dest = path.join(mediaScratchDir(), `${key}${ext}`)

  try {
    await fsp.access(dest)
    return dest
  } catch {
    /* need copy */
  }

  const pending = scratchInFlight.get(key)
  if (pending) return pending

  const job = (async (): Promise<string> => {
    await fsp.mkdir(mediaScratchDir(), { recursive: true })
    const tmp = `${dest}.tmp`
    try {
      await fsp.copyFile(filePath, tmp)
      await fsp.rename(tmp, dest)
      return dest
    } catch (e) {
      await fsp.unlink(tmp).catch(() => undefined)
      throw e
    } finally {
      scratchInFlight.delete(key)
    }
  })()
  scratchInFlight.set(key, job)
  return job
}

function bufferedResponse(buf: Buffer, filePath: string): Response {
  const body = new Uint8Array(buf.byteLength)
  body.set(buf)
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': mimeFor(filePath),
      'Content-Length': String(body.byteLength),
      // Body is already detached from the source file.
      'Cache-Control': 'private, max-age=300'
    }
  })
}

/**
 * Serve allowlisted files. Never hand Chromium a file:// URL to a browsed path.
 */
export function registerMediaProtocolHandler(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const requested = mediaPathFromUrl(request.url)
    if (!requested || !protocolAllowlist.isFileAllowed(requested)) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      const st = await fsp.stat(requested)
      if (!st.isFile() || st.size <= 0) {
        return new Response('Not found', { status: 404 })
      }

      if (st.size <= MAX_BUFFER_BYTES) {
        const buf = await fsp.readFile(requested)
        return bufferedResponse(buf, requested)
      }

      // Too large to keep in RAM — Chromium streams the scratch copy only.
      const scratch = await ensureScratchCopy(requested, st.mtimeMs, st.size)
      return await net.fetch(pathToFileURL(scratch).toString(), {
        bypassCustomProtocolHandlers: true
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

/** Drop scratch copies (Settings → clear caches can call this later). */
export async function clearMediaScratch(): Promise<void> {
  const dir = mediaScratchDir()
  await fsp.rm(dir, { recursive: true, force: true })
  await fsp.mkdir(dir, { recursive: true })
}
