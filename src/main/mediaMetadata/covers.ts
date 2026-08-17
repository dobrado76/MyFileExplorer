import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import { parseMediaFileName, type MediaMetadata } from '@shared/mediaMetadata'
import { requireAbsolute } from '../fs/list'
import { invalidateColumnMetaPaths } from '../meta/columns'
import {
  downloadImage,
  listTmdbPosterPaths,
  tmdbPosterOriginalUrl,
  tmdbPosterPreviewUrl
} from './internet'
import {
  downloadPlexThumb,
  extractFromPlex,
  listPlexHttpPosters,
  listPlexLocalPosterFiles,
  resolvePlex
} from './plex'
import { readMediaMetadata, readMediaThumbnail, writeMediaMetadata, writeMediaThumbnail } from './store'

export type MediaCoverChoice = {
  id: string
  source: 'plex' | 'tmdb' | 'current'
  label: string
  selected: boolean
  previewBase64: string
  width: number
  height: number
}

type CoverLoader = () => Promise<Buffer | null>

type CoverSession = {
  at: number
  loaders: Map<string, CoverLoader>
}

type CoverDraft = {
  id: string
  source: MediaCoverChoice['source']
  label: string
  selected: boolean
  width: number
  height: number
  bytes: number
  previewBuf: Buffer | null
  loadPreview: () => Promise<Buffer | null>
  loader: CoverLoader
}

const sessions = new Map<string, CoverSession>()
const MAX_COVERS = 48
const SESSION_MS = 15 * 60 * 1000

function pruneSessions(): void {
  const now = Date.now()
  for (const [k, s] of sessions) {
    if (now - s.at > SESSION_MS) sessions.delete(k)
  }
}

function sha1(buf: Buffer): string {
  return createHash('sha1').update(buf).digest('hex')
}

/** Larger pixel area first; same area → larger file first. */
export function compareCoverSize(
  a: { width: number; height: number; bytes: number },
  b: { width: number; height: number; bytes: number }
): number {
  const pa = Math.max(0, a.width) * Math.max(0, a.height)
  const pb = Math.max(0, b.width) * Math.max(0, b.height)
  if (pb !== pa) return pb - pa
  return b.bytes - a.bytes
}

async function imageMeta(buf: Buffer): Promise<{ width: number; height: number }> {
  try {
    const sharp = (await import('sharp')).default
    const m = await sharp(buf, { failOn: 'none', limitInputPixels: 80 * 1024 * 1024 }).metadata()
    return { width: m.width ?? 0, height: m.height ?? 0 }
  } catch {
    return { width: 0, height: 0 }
  }
}

async function previewJpeg(buf: Buffer): Promise<string | null> {
  try {
    const sharp = (await import('sharp')).default
    const out = await sharp(buf, { failOn: 'none', limitInputPixels: 80 * 1024 * 1024 })
      .rotate()
      .resize(140, 210, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer()
    return out.toString('base64')
  } catch {
    if (buf.length > 32 && buf.length < 400_000) return buf.toString('base64')
    return null
  }
}

async function plexSourceId(filePath: string, meta: MediaMetadata | null): Promise<string | null> {
  if (meta?.source === 'plex' && meta.sourceId) return meta.sourceId
  try {
    const hit = await extractFromPlex(filePath, undefined, { skipPoster: true })
    return hit.meta.sourceId ?? null
  } catch {
    return meta?.sourceId ?? null
  }
}

export async function listMediaCovers(rawPath: string): Promise<{
  title: string
  covers: MediaCoverChoice[]
}> {
  const file = requireAbsolute(rawPath)
  pruneSessions()
  const meta = await readMediaMetadata(file)
  const current = await readMediaThumbnail(file)
  const currentHash = current && current.length > 32 ? sha1(current) : null
  const drafts: CoverDraft[] = []
  const seenHash = new Set<string>()
  const seenKey = new Set<string>()

  const addDraft = (draft: CoverDraft, contentForHash?: Buffer | null, key?: string): void => {
    if (key) {
      const k = key.toLowerCase()
      if (seenKey.has(k)) return
      seenKey.add(k)
    }
    if (contentForHash && contentForHash.length > 32) {
      const h = sha1(contentForHash)
      if (seenHash.has(h)) return
      seenHash.add(h)
    }
    drafts.push(draft)
  }

  if (current && current.length > 32) {
    const dim = await imageMeta(current)
    addDraft(
      {
        id: 'current',
        source: 'current',
        label: 'Current',
        selected: true,
        width: dim.width,
        height: dim.height,
        bytes: current.length,
        previewBuf: current,
        loadPreview: async () => current,
        loader: async () => current
      },
      current,
      'current'
    )
  }

  const plexId = await plexSourceId(file, meta)
  const resolved = await resolvePlex()
  if (resolved.dataDir && plexId) {
    const files = await listPlexLocalPosterFiles(resolved.dataDir, plexId)
    let i = 0
    for (const f of files) {
      try {
        const buf = await fsp.readFile(f.absPath)
        if (buf.length < 32) continue
        const dim = await imageMeta(buf)
        const id = `plex-local-${i++}`
        const abs = f.absPath
        addDraft(
          {
            id,
            source: 'plex',
            label: 'Plex',
            selected: currentHash != null && sha1(buf) === currentHash,
            width: dim.width,
            height: dim.height,
            bytes: buf.length,
            previewBuf: buf,
            loadPreview: async () => buf,
            loader: async () => fsp.readFile(abs)
          },
          buf,
          abs
        )
      } catch {
        /* skip unreadable */
      }
    }
  }
  if (plexId) {
    const http = await listPlexHttpPosters(plexId)
    let i = 0
    for (const p of http) {
      const id = `plex-http-${i++}`
      const href = p.href
      const previewHref = p.previewHref
      addDraft(
        {
          id,
          source: 'plex',
          label: 'Plex',
          selected: false,
          width: p.width,
          height: p.height,
          bytes: p.width * p.height,
          previewBuf: null,
          loadPreview: async () => (await downloadPlexThumb(previewHref)) ?? (await downloadPlexThumb(href)),
          loader: async () => downloadPlexThumb(href)
        },
        null,
        href
      )
    }
  }

  const title = meta?.title || parseMediaFileName(path.basename(file)).title
  const year = meta?.year
  const sourceId = meta?.source === 'tmdb' ? meta.sourceId : undefined
  const paths = await listTmdbPosterPaths({ sourceId, title, year })
  let ti = 0
  for (const poster of paths) {
    const id = `tmdb-${ti++}`
    const posterPath = poster.filePath
    const fullUrl = tmdbPosterOriginalUrl(posterPath)
    addDraft(
      {
        id,
        source: 'tmdb',
        label: 'TMDB',
        selected: false,
        width: poster.width,
        height: poster.height,
        bytes: poster.width * poster.height,
        previewBuf: null,
        loadPreview: async () => downloadImage(tmdbPosterPreviewUrl(posterPath)),
        loader: async () => downloadImage(fullUrl)
      },
      null,
      posterPath
    )
  }

  drafts.sort(compareCoverSize)
  const chosen = drafts.slice(0, MAX_COVERS)
  const loaders = new Map<string, CoverLoader>()
  const covers: MediaCoverChoice[] = []
  for (const d of chosen) {
    const previewBuf = d.previewBuf ?? (await d.loadPreview())
    if (!previewBuf || previewBuf.length < 32) continue
    const previewBase64 = await previewJpeg(previewBuf)
    if (!previewBase64) continue
    const isCurrent = currentHash != null && sha1(previewBuf) === currentHash
    loaders.set(d.id, d.loader)
    covers.push({
      id: d.id,
      source: d.source,
      label: d.label,
      selected: d.selected || isCurrent,
      previewBase64,
      width: d.width,
      height: d.height
    })
  }

  sessions.set(file.toLowerCase(), { at: Date.now(), loaders })
  return { title: meta?.title || path.basename(file), covers }
}

export async function setMediaCover(rawPath: string, coverId: string): Promise<void> {
  const file = requireAbsolute(rawPath)
  const session = sessions.get(file.toLowerCase())
  const loader = session?.loaders.get(coverId)
  if (!loader) throw new AppError('validation', 'Cover list expired — open Change cover again')
  const buf = await loader()
  if (!buf || buf.length < 32) throw new AppError('io', 'Could not load that cover')
  let meta = await readMediaMetadata(file)
  if (!meta) {
    try {
      const hit = await extractFromPlex(file)
      meta = hit.meta
      await writeMediaMetadata(file, meta, buf)
    } catch {
      throw new AppError('io', 'Extract metadata first, then change the cover')
    }
  } else {
    await writeMediaThumbnail(file, buf)
  }
  await invalidateColumnMetaPaths([file])
}
