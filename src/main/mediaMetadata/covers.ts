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
}

type CoverLoader = () => Promise<Buffer | null>

type CoverSession = {
  at: number
  loaders: Map<string, CoverLoader>
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
  const loaders = new Map<string, CoverLoader>()
  const covers: MediaCoverChoice[] = []
  const seenHash = new Set<string>()

  const add = async (
    id: string,
    source: MediaCoverChoice['source'],
    label: string,
    previewBuf: Buffer,
    loader: CoverLoader,
    selected: boolean
  ): Promise<void> => {
    if (covers.length >= MAX_COVERS) return
    const h = sha1(previewBuf)
    if (seenHash.has(h)) return
    seenHash.add(h)
    const previewBase64 = await previewJpeg(previewBuf)
    if (!previewBase64) return
    const isCurrent = currentHash != null && sha1(previewBuf) === currentHash
    loaders.set(id, loader)
    covers.push({
      id,
      source,
      label,
      selected: selected || isCurrent,
      previewBase64
    })
  }

  if (current && current.length > 32) {
    await add('current', 'current', 'Current', current, async () => current, true)
  }

  const plexId = await plexSourceId(file, meta)
  const resolved = await resolvePlex()
  if (resolved.dataDir && plexId) {
    const files = await listPlexLocalPosterFiles(resolved.dataDir, plexId)
    let i = 0
    for (const f of files) {
      if (covers.length >= MAX_COVERS) break
      try {
        const buf = await fsp.readFile(f.absPath)
        if (buf.length < 32) continue
        const id = `plex-local-${i++}`
        await add(id, 'plex', 'Plex', buf, async () => fsp.readFile(f.absPath), f.selected)
      } catch {
        /* skip unreadable */
      }
    }
  }
  if (plexId && covers.length < MAX_COVERS) {
    const http = await listPlexHttpPosters(plexId)
    let i = 0
    for (const p of http) {
      if (covers.length >= MAX_COVERS) break
      const preview = (await downloadPlexThumb(p.previewHref)) ?? (await downloadPlexThumb(p.href))
      if (!preview) continue
      const id = `plex-http-${i++}`
      const href = p.href
      await add(id, 'plex', 'Plex', preview, async () => downloadPlexThumb(href), p.selected)
    }
  }

  if (covers.length < MAX_COVERS) {
    const title = meta?.title || parseMediaFileName(path.basename(file)).title
    const year = meta?.year
    const sourceId = meta?.source === 'tmdb' ? meta.sourceId : undefined
    const paths = await listTmdbPosterPaths({ sourceId, title, year })
    let i = 0
    for (const posterPath of paths) {
      if (covers.length >= MAX_COVERS) break
      const preview = await downloadImage(tmdbPosterPreviewUrl(posterPath))
      if (!preview) continue
      const id = `tmdb-${i++}`
      const fullUrl = tmdbPosterOriginalUrl(posterPath)
      await add(id, 'tmdb', 'TMDB', preview, async () => downloadImage(fullUrl), false)
    }
  }

  if (covers.length > 0 && !covers.some((c) => c.selected)) covers[0]!.selected = true

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
