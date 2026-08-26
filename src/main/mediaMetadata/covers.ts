import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import { parseMediaFileName, type MediaMetadata } from '@shared/mediaMetadata'
import { pathKey } from '@shared/paths'
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
import { broadcast } from '../ipc/events'
import { readMediaMetadata, readMediaThumbnail, writeMediaMetadata, writeMediaThumbnail } from './store'

export type MediaCoverChoice = {
  id: string
  source: 'plex' | 'tmdb' | 'current' | 'custom'
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
  previews: Map<string, Buffer>
}

function usableImage(buf: Buffer | null | undefined): Buffer | null {
  return buf && buf.length >= 32 ? buf : null
}

function sessionKey(file: string): string {
  return pathKey(file)
}

function encodePart(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url')
}

function decodePart(s: string | undefined): string | null {
  if (!s) return null
  try {
    return Buffer.from(s, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

export function plexFileCoverId(absPath: string): string {
  return `plex-file:${encodePart(absPath)}`
}

export function plexUrlCoverId(href: string, previewHref: string): string {
  return `plex-url:${encodePart(href)}.${encodePart(previewHref)}`
}

export function tmdbCoverId(posterPath: string): string {
  return `tmdb:${encodePart(posterPath)}`
}

export function customFileCoverId(absPath: string): string {
  return `custom-file:${encodePart(absPath)}`
}

export function parseCoverSourceId(id: string):
  | { kind: 'current' }
  | { kind: 'plex-file'; path: string }
  | { kind: 'plex-url'; href: string; previewHref: string }
  | { kind: 'tmdb'; posterPath: string }
  | { kind: 'custom-file'; path: string }
  | null {
  if (id === 'current') return { kind: 'current' }
  if (id.startsWith('plex-file:')) {
    const p = decodePart(id.slice('plex-file:'.length))
    return p ? { kind: 'plex-file', path: p } : null
  }
  if (id.startsWith('plex-url:')) {
    const [hrefPart, previewPart] = id.slice('plex-url:'.length).split('.')
    const href = decodePart(hrefPart)
    const previewHref = decodePart(previewPart)
    return href && previewHref ? { kind: 'plex-url', href, previewHref } : null
  }
  if (id.startsWith('tmdb:')) {
    const posterPath = decodePart(id.slice('tmdb:'.length))
    return posterPath ? { kind: 'tmdb', posterPath } : null
  }
  if (id.startsWith('custom-file:')) {
    const p = decodePart(id.slice('custom-file:'.length))
    return p ? { kind: 'custom-file', path: p } : null
  }
  return null
}

async function loadFromCoverId(coverId: string): Promise<Buffer | null> {
  const src = parseCoverSourceId(coverId)
  if (!src || src.kind === 'current') return null
  if (src.kind === 'plex-file') {
    try {
      return usableImage(await fsp.readFile(src.path))
    } catch {
      return null
    }
  }
  if (src.kind === 'custom-file') {
    try {
      return usableImage(await fsp.readFile(src.path))
    } catch {
      return null
    }
  }
  if (src.kind === 'plex-url') {
    const full = usableImage(await downloadPlexThumb(src.href))
    if (full) return full
    return usableImage(await downloadPlexThumb(src.previewHref))
  }
  return (
    usableImage(await downloadImage(tmdbPosterOriginalUrl(src.posterPath))) ??
    usableImage(await downloadImage(tmdbPosterPreviewUrl(src.posterPath)))
  )
}

function bytesFromBase64(raw?: string): Buffer | null {
  if (!raw) return null
  try {
    return usableImage(Buffer.from(raw, 'base64'))
  } catch {
    return null
  }
}

function rememberCover(
  session: CoverSession,
  id: string,
  loader: CoverLoader,
  preview?: Buffer | null
): void {
  if (preview && preview.length >= 32) session.previews.set(id, preview)
  session.loaders.set(id, async () => {
    try {
      const full = usableImage(await loader())
      if (full) return full
    } catch {
      /* fall back to the preview already shown in the picker */
    }
    return usableImage(session.previews.get(id))
  })
  session.at = Date.now()
}

async function loadCoverBytes(session: CoverSession | undefined, coverId: string): Promise<Buffer | null> {
  if (!session) return null
  const loader = session.loaders.get(coverId)
  if (loader) {
    const buf = usableImage(await loader())
    if (buf) return buf
  }
  return usableImage(session.previews.get(coverId))
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
const PREVIEW_CONCURRENCY = 6
let coverListJob = 0
const coverListJobByPath = new Map<string, number>()

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

function coverJobLive(fileKey: string, job: number): boolean {
  return coverListJobByPath.get(fileKey) === job
}

async function choiceFromDraft(
  draft: CoverDraft,
  currentHash: string | null
): Promise<MediaCoverChoice | null> {
  const previewBuf = draft.previewBuf ?? (await draft.loadPreview())
  if (!previewBuf || previewBuf.length < 32) return null
  draft.previewBuf = previewBuf
  const previewBase64 = await previewJpeg(previewBuf)
  if (!previewBase64) return null
  const isCurrent = currentHash != null && sha1(previewBuf) === currentHash
  return {
    id: draft.id,
    source: draft.source,
    label: draft.label,
    selected: draft.selected || isCurrent,
    previewBase64,
    width: draft.width,
    height: draft.height
  }
}

async function emitCover(
  file: string,
  fileKey: string,
  job: number,
  cover: MediaCoverChoice
): Promise<void> {
  if (!coverJobLive(fileKey, job)) return
  broadcast({ type: 'cover-list', payload: { path: file, cover, done: false } })
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const n = Math.max(1, Math.min(limit, items.length))
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const item = items[next]!
        next += 1
        await fn(item)
      }
    })
  )
}

async function continueCoverList(
  file: string,
  meta: MediaMetadata | null,
  current: Buffer | null,
  job: number,
  session: CoverSession
): Promise<void> {
  const fileKey = sessionKey(file)
  const currentHash = current && current.length > 32 ? sha1(current) : null
  const seenHash = new Set<string>(currentHash ? [currentHash] : [])
  const seenKey = new Set<string>(['current'])
  const remotes: CoverDraft[] = []

  const takeDraft = (draft: CoverDraft, contentForHash?: Buffer | null, key?: string): boolean => {
    if (key) {
      const k = key.toLowerCase()
      if (seenKey.has(k)) return false
      seenKey.add(k)
    }
    if (contentForHash && contentForHash.length > 32) {
      const h = sha1(contentForHash)
      if (seenHash.has(h)) return false
      seenHash.add(h)
    }
    rememberCover(session, draft.id, draft.loader, draft.previewBuf)
    return true
  }

  const publish = async (draft: CoverDraft): Promise<void> => {
    if (!coverJobLive(fileKey, job)) return
    try {
      const cover = await choiceFromDraft(draft, currentHash)
      if (!cover) return
      const preview = draft.previewBuf
      rememberCover(session, draft.id, draft.loader, preview)
      if (coverJobLive(fileKey, job)) await emitCover(file, fileKey, job, cover)
    } catch {
      /* skip */
    }
  }

  try {
    const title = meta?.title || parseMediaFileName(path.basename(file)).title
    const year = meta?.year
    const sourceId = meta?.source === 'tmdb' ? meta.sourceId : undefined
    const tmdbP = listTmdbPosterPaths({ sourceId, title, year })
    const plexIdP = plexSourceId(file, meta)
    const resolvedP = resolvePlex()

    const plexId = await plexIdP
    const resolved = await resolvedP
    if (!coverJobLive(fileKey, job)) return

    if (resolved.dataDir && plexId) {
      const files = await listPlexLocalPosterFiles(resolved.dataDir, plexId)
      for (const f of files) {
        if (!coverJobLive(fileKey, job)) return
        try {
          const buf = await fsp.readFile(f.absPath)
          if (buf.length < 32) continue
          const dim = await imageMeta(buf)
          const abs = f.absPath
          const id = plexFileCoverId(abs)
          const draft: CoverDraft = {
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
          }
          if (takeDraft(draft, buf, abs)) await publish(draft)
        } catch {
          /* skip unreadable */
        }
      }
    }

    if (plexId && coverJobLive(fileKey, job)) {
      const http = await listPlexHttpPosters(plexId)
      for (const p of http) {
        const href = p.href
        const previewHref = p.previewHref
        const id = plexUrlCoverId(href, previewHref)
        const draft: CoverDraft = {
          id,
          source: 'plex',
          label: 'Plex',
          selected: false,
          width: p.width,
          height: p.height,
          bytes: p.width * p.height,
          previewBuf: null,
          loadPreview: async () =>
            (await downloadPlexThumb(previewHref)) ?? (await downloadPlexThumb(href)),
          loader: async () =>
            (await downloadPlexThumb(href)) ?? (await downloadPlexThumb(previewHref))
        }
        if (takeDraft(draft, null, href)) remotes.push(draft)
      }
    }

    if (coverJobLive(fileKey, job)) {
      const paths = await tmdbP
      for (const poster of paths) {
        const posterPath = poster.filePath
        const id = tmdbCoverId(posterPath)
        const fullUrl = tmdbPosterOriginalUrl(posterPath)
        const draft: CoverDraft = {
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
        }
        if (takeDraft(draft, null, posterPath)) remotes.push(draft)
      }
    }

    remotes.sort(compareCoverSize)
    const already = session.loaders.size - remotes.length
    const chosen = remotes.slice(0, Math.max(0, MAX_COVERS - already))
    await runPool(chosen, PREVIEW_CONCURRENCY, publish)
  } finally {
    if (coverJobLive(fileKey, job)) {
      broadcast({ type: 'cover-list', payload: { path: file, done: true } })
    }
  }
}

export async function listMediaCovers(rawPath: string): Promise<{
  title: string
  covers: MediaCoverChoice[]
}> {
  const file = requireAbsolute(rawPath)
  pruneSessions()
  const fileKey = sessionKey(file)
  const job = ++coverListJob
  coverListJobByPath.set(fileKey, job)

  let session = sessions.get(fileKey)
  if (!session) {
    session = { at: Date.now(), loaders: new Map(), previews: new Map() }
    sessions.set(fileKey, session)
  } else {
    session.at = Date.now()
  }

  const meta = await readMediaMetadata(file)
  const current = await readMediaThumbnail(file)

  const covers: MediaCoverChoice[] = []
  if (current && current.length > 32) {
    rememberCover(session, 'current', async () => current, current)
    const dim = await imageMeta(current)
    const previewBase64 = await previewJpeg(current)
    if (previewBase64) {
      covers.push({
        id: 'current',
        source: 'current',
        label: 'Current',
        selected: true,
        previewBase64,
        width: dim.width,
        height: dim.height
      })
    }
  }

  void continueCoverList(file, meta, current, job, session)
  return { title: meta?.title || path.basename(file), covers }
}

/** Register a user-picked image file as a cover choice (session-backed for setCover). */
export async function loadCustomCover(
  rawMediaPath: string,
  rawImagePath: string
): Promise<MediaCoverChoice> {
  const file = requireAbsolute(rawMediaPath)
  const imagePath = requireAbsolute(rawImagePath)
  const buf = usableImage(await fsp.readFile(imagePath))
  if (!buf) {
    throw new AppError('validation', 'That file is not a usable image.')
  }
  const dim = await imageMeta(buf)
  const previewBase64 = await previewJpeg(buf)
  if (!previewBase64) {
    throw new AppError('io', 'Could not read that image.')
  }

  pruneSessions()
  const fileKey = sessionKey(file)
  let session = sessions.get(fileKey)
  if (!session) {
    session = { at: Date.now(), loaders: new Map(), previews: new Map() }
    sessions.set(fileKey, session)
  }
  const id = customFileCoverId(imagePath)
  rememberCover(session, id, async () => fsp.readFile(imagePath), buf)

  const current = await readMediaThumbnail(file)
  const currentHash = current && current.length > 32 ? sha1(current) : null
  const isCurrent = currentHash != null && sha1(buf) === currentHash

  return {
    id,
    source: 'custom',
    label: path.basename(imagePath),
    selected: isCurrent,
    previewBase64,
    width: dim.width,
    height: dim.height
  }
}

export async function setMediaCover(
  rawPath: string,
  coverId: string,
  previewBase64?: string
): Promise<void> {
  const file = requireAbsolute(rawPath)
  const key = sessionKey(file)
  const session = sessions.get(key) ?? sessions.get(file.toLowerCase())
  const buf =
    (await loadCoverBytes(session, coverId)) ??
    (await loadFromCoverId(coverId)) ??
    (coverId === 'current' ? usableImage(await readMediaThumbnail(file)) : null) ??
    bytesFromBase64(previewBase64)
  if (!buf) {
    throw new AppError('io', 'Could not load that cover')
  }
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
