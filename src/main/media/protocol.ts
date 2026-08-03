import { protocol, net } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { protocolAllowlist } from '../security/paths'
import { MODEL_SCHEME } from './modelProtocol'
import { ORT_SCHEME } from './ortProtocol'

export const MEDIA_SCHEME = 'mfe-media'

/** Buffer image responses under this size so Chromium does not keep the source file open. */
const MAX_IMAGE_BUFFER_BYTES = 96 * 1024 * 1024

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'avif',
  'tif',
  'tiff',
  'ico',
  'svg'
])

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
  svg: 'image/svg+xml'
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

/**
 * Serve allowlisted files. Images (under size cap) are fully buffered so the
 * OS file handle is closed before Chromium paints — otherwise Windows delete
 * fails with “in use by another process” while the preview/viewer is open.
 */
export function registerMediaProtocolHandler(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const requested = mediaPathFromUrl(request.url)
    if (!requested || !protocolAllowlist.isFileAllowed(requested)) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      const ext = path.extname(requested).slice(1).toLowerCase()
      if (IMAGE_EXTS.has(ext)) {
        const st = await fsp.stat(requested)
        if (st.isFile() && st.size > 0 && st.size <= MAX_IMAGE_BUFFER_BYTES) {
          const buf = await fsp.readFile(requested)
          return new Response(buf, {
            status: 200,
            headers: {
              'Content-Type': mimeFor(requested),
              'Content-Length': String(buf.byteLength),
              // Memory/disk HTTP cache is fine — the body is already buffered so
              // the source file handle is closed. no-store forced re-reads on
              // every <img> paint (brutal for animated video strips).
              'Cache-Control': 'private, max-age=300'
            }
          })
        }
      }
      return await net.fetch(pathToFileURL(requested).toString(), {
        bypassCustomProtocolHandlers: true
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
