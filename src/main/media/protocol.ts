/**
 * Serve allowlisted browsed files over mfe-media without handing Chromium a
 * file:// URL to user paths (D7 — Recycle Bin / open handles).
 *
 * Images / small blobs: full buffer, then source fd closed.
 * Audio / video / PDF: HTTP byte-range responses (206). Chromium’s media
 * pipeline requires Accept-Ranges + Content-Range; without them `<video>`
 * fails even for ordinary H.264 MP4 (Electron protocol.handle).
 *
 * <=128 MiB seekable: ranges served from an in-memory copy (source closed).
 * Larger seekable: byte-range streams from the allowlisted path (no full
 * scratch copy — multi-GB movies must start without a second disk write).
 */
import { app, protocol } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
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
  wma: 'audio/x-ms-wma',
  opus: 'audio/opus',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  flv: 'video/x-flv',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  json: 'application/json'
}

/** Types Chromium fetches with Range requests. */
const SEEKABLE_EXTS = new Set([
  'mp4',
  'm4v',
  'webm',
  'mkv',
  'mov',
  'avi',
  'wmv',
  'mpg',
  'mpeg',
  'ts',
  'm2ts',
  'flv',
  'mp3',
  'wav',
  'flac',
  'm4a',
  'ogg',
  'aac',
  'wma',
  'opus',
  'pdf'
])

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

function extOf(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase()
}

function mimeFor(filePath: string): string {
  return MIME_BY_EXT[extOf(filePath)] ?? 'application/octet-stream'
}

function isSeekable(filePath: string): boolean {
  return SEEKABLE_EXTS.has(extOf(filePath))
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

function parseRangeHeader(
  rangeHeader: string,
  size: number
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!match) return null

  const startRaw = match[1]!
  const endRaw = match[2]!
  let start = startRaw ? Number.parseInt(startRaw, 10) : Number.NaN
  let end = endRaw ? Number.parseInt(endRaw, 10) : Number.NaN

  if (Number.isNaN(start) && Number.isNaN(end)) return null

  if (Number.isNaN(start)) {
    const suffixLength = end
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else if (Number.isNaN(end)) {
    end = size - 1
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null
  }

  return { start, end: Math.min(end, size - 1) }
}

function baseMediaHeaders(mime: string): Record<string, string> {
  return {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    // no-store: Chromium media cache + custom protocols has broken seeking in
    // several Electron versions when responses are cached aggressively.
    'Cache-Control': 'private, no-store'
  }
}

function serveBufferWithRanges(buf: Buffer, request: Request, mime: string): Response {
  const size = buf.byteLength
  const headers = baseMediaHeaders(mime)
  const rangeHeader = request.headers.get('range')

  if (!rangeHeader) {
    const body = new Uint8Array(buf.byteLength)
    body.set(buf)
    return new Response(body, {
      status: 200,
      headers: { ...headers, 'Content-Length': String(size) }
    })
  }

  const range = parseRangeHeader(rangeHeader, size)
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` }
    })
  }

  const slice = buf.subarray(range.start, range.end + 1)
  const body = new Uint8Array(slice.byteLength)
  body.set(slice)
  return new Response(body, {
    status: 206,
    headers: {
      ...headers,
      'Content-Length': String(body.byteLength),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`
    }
  })
}

function serveFileWithRanges(filePath: string, size: number, request: Request, mime: string): Response {
  const headers = baseMediaHeaders(mime)
  const rangeHeader = request.headers.get('range')

  if (!rangeHeader) {
    const stream = fs.createReadStream(filePath)
    return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
      status: 200,
      headers: { ...headers, 'Content-Length': String(size) }
    })
  }

  const range = parseRangeHeader(rangeHeader, size)
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` }
    })
  }

  const contentLength = range.end - range.start + 1
  const stream = fs.createReadStream(filePath, { start: range.start, end: range.end })
  return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
    status: 206,
    headers: {
      ...headers,
      'Content-Length': String(contentLength),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`
    }
  })
}

function bufferedResponse(buf: Buffer, filePath: string): Response {
  const body = new Uint8Array(buf.byteLength)
  body.set(buf)
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': mimeFor(filePath),
      'Content-Length': String(body.byteLength),
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

      const mime = mimeFor(requested)

      if (isSeekable(requested)) {
        // Typical sizes: buffer then close source (D7). Huge AV: range from path
        // so playback starts immediately (full scratch copy of movies is unusable).
        if (st.size <= MAX_BUFFER_BYTES) {
          const buf = await fsp.readFile(requested)
          return serveBufferWithRanges(buf, request, mime)
        }
        return serveFileWithRanges(requested, st.size, request, mime)
      }

      if (st.size <= MAX_BUFFER_BYTES) {
        const buf = await fsp.readFile(requested)
        return bufferedResponse(buf, requested)
      }

      const scratch = await ensureScratchCopy(requested, st.mtimeMs, st.size)
      const scratchStat = await fsp.stat(scratch)
      return serveFileWithRanges(scratch, scratchStat.size, request, mime)
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
