import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import {
  isGenericMediaFolderName,
  parseMediaFileName,
  type MediaMetadata
} from '@shared/mediaMetadata'
import { requireAbsolute } from '../fs/list'
import { beginOp } from '../fs/opProgress'
import { invalidateColumnMetaPaths } from '../meta/columns'
import { downloadFromInternet, downloadImage } from './internet'
import { downloadPlexThumb, extractFromPlex, probePlex } from './plex'
import {
  clearMediaMetadata,
  readMediaMetadata,
  readMediaThumbnail,
  writeMediaMetadata
} from './store'

const VIDEO_EXTS = new Set([
  'mp4',
  'mkv',
  'webm',
  'avi',
  'divx',
  'mov',
  'wmv',
  'm4v',
  'mpg',
  'mpeg',
  'ts',
  'm2ts'
])

const MAX_WALK = 20_000
export type MediaMetadataOpResult = {
  done: number
  failed: { path: string; message: string }[]
  updated: string[]
}

export { probePlex }

function isVideoName(name: string): boolean {
  const ext = path.extname(name).slice(1).toLowerCase()
  return VIDEO_EXTS.has(ext)
}

function folderSearchName(dir: string): string {
  const base = path.basename(dir)
  if (/^(season\s*\d+|s\d{1,2}|specials)$/i.test(base)) {
    return path.basename(path.dirname(dir))
  }
  return base
}

async function walkMediaTree(
  dir: string,
  videos: string[],
  folders: Set<string>
): Promise<void> {
  if (videos.length >= MAX_WALK) return
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  let hasVideoHere = false
  const subdirs: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isFile() && isVideoName(e.name)) {
      videos.push(full)
      hasVideoHere = true
      if (videos.length >= MAX_WALK) return
    } else if (e.isDirectory()) {
      subdirs.push(full)
    }
  }
  if (hasVideoHere) folders.add(dir)
  for (const sub of subdirs) {
    const before = videos.length
    await walkMediaTree(sub, videos, folders)
    if (videos.length > before) folders.add(dir)
  }
}

function isSeasonFolderName(name: string): boolean {
  return /^(season\s*\d+|s\d{1,2}|specials)$/i.test(name)
}

function shouldWriteFolderMeta(dir: string, childFolders: string[]): boolean {
  if (isGenericMediaFolderName(path.basename(dir))) return false
  const direct = childFolders.filter((f) => f !== dir && path.dirname(f) === dir)
  const nonSeason = direct.filter((f) => !isSeasonFolderName(path.basename(f)))
  return nonSeason.length <= 8
}

async function expandTargets(rawPaths: string[]): Promise<{ videos: string[]; folders: string[] }> {
  const videos: string[] = []
  const folderSet = new Set<string>()
  for (const raw of rawPaths) {
    const p = requireAbsolute(raw)
    let st
    try {
      st = await fsp.stat(p)
    } catch {
      continue
    }
    if (st.isFile()) {
      if (isVideoName(p)) videos.push(p)
      continue
    }
    if (st.isDirectory()) {
      await walkMediaTree(p, videos, folderSet)
    }
  }
  const allFolders = [...folderSet]
  const folders = allFolders.filter((d) => shouldWriteFolderMeta(d, allFolders))
  return { videos: [...new Set(videos)], folders }
}

async function applyHit(
  target: string,
  hit: { meta: MediaMetadata; thumbUrl: string | null; thumbUrls?: string[]; thumbBytes?: Buffer | null },
  fetchThumb: (url: string) => Promise<Buffer | null>
): Promise<void> {
  let thumb: Buffer | null = hit.thumbBytes && hit.thumbBytes.length > 0 ? hit.thumbBytes : null
  if (!thumb) {
    const urls = [...new Set([...(hit.thumbUrls ?? []), ...(hit.thumbUrl ? [hit.thumbUrl] : [])])]
    for (const url of urls) {
      thumb = await fetchThumb(url)
      if (thumb && thumb.length > 0) break
      thumb = null
    }
  }
  await writeMediaMetadata(target, hit.meta, thumb)
  await invalidateColumnMetaPaths([target])
}

function asShowFolderMeta(meta: MediaMetadata): MediaMetadata {
  if (meta.kind !== 'episode' || !meta.showTitle) return meta
  return {
    ...meta,
    kind: 'show',
    title: meta.showTitle,
    season: undefined,
    episode: undefined,
    showTitle: undefined
  }
}

async function extractOnePlex(target: string): Promise<void> {
  const st = await fsp.stat(target)
  if (st.isFile()) {
    const hit = await extractFromPlex(target)
    await applyHit(target, hit, downloadPlexThumb)
    return
  }
  const videos: string[] = []
  const folders = new Set<string>()
  await walkMediaTree(target, videos, folders)
  const hint = parseMediaFileName(folderSearchName(target)).title
  if (videos[0]) {
    try {
      const hit = await extractFromPlex(videos[0], hint)
      hit.meta = asShowFolderMeta(hit.meta)
      await applyHit(target, hit, downloadPlexThumb)
      return
    } catch {
      /* title search */
    }
  }
  const hit = await extractFromPlex(target, hint)
  hit.meta = asShowFolderMeta(hit.meta)
  await applyHit(target, hit, downloadPlexThumb)
}

async function downloadOneInternet(target: string): Promise<void> {
  const st = await fsp.stat(target)
  const name = st.isDirectory() ? folderSearchName(target) : path.basename(target)
  const parsed = parseMediaFileName(name)
  const hit = await downloadFromInternet(parsed)
  if (st.isDirectory()) hit.meta = asShowFolderMeta(hit.meta)
  await applyHit(target, hit, downloadImage)
}

async function runOnTargets(
  label: string,
  rawPaths: string[],
  each: (target: string) => Promise<boolean>,
  opts?: { onlyMissing?: boolean }
): Promise<MediaMetadataOpResult> {
  const expanded = await expandTargets(rawPaths)
  const unique = [...new Set([...expanded.videos, ...expanded.folders])]
  const failed: { path: string; message: string }[] = []
  const updated: string[] = []
  const op = beginOp('media-metadata', unique.length, label)
  try {
    for (const target of unique) {
      op.throwIfCancelled()
      try {
        if (opts?.onlyMissing) {
          const existing = await readMediaMetadata(target)
          if (existing) {
            op.tick(path.basename(target))
            continue
          }
        }
        if (await each(target)) updated.push(target)
      } catch (e) {
        if (e instanceof AppError && e.code === 'cancelled') throw e
        failed.push({ path: target, message: e instanceof Error ? e.message : String(e) })
      }
      op.tick(path.basename(target))
    }
    op.finish()
  } catch (e) {
    op.fail()
    throw e
  }
  if (updated.length === 0 && failed.length > 0) {
    throw new AppError('io', failed[0]!.message, undefined, failed[0]!.path)
  }
  return { done: updated.length, failed, updated }
}

export async function extractPlexMany(paths: string[]): Promise<MediaMetadataOpResult> {
  return runOnTargets(
    'Extracting media metadata…',
    paths,
    async (target) => {
      await extractOnePlex(target)
      return true
    },
    { onlyMissing: true }
  )
}

export async function downloadInternetMany(paths: string[]): Promise<MediaMetadataOpResult> {
  return runOnTargets(
    'Downloading media metadata…',
    paths,
    async (target) => {
      await downloadOneInternet(target)
      return true
    },
    { onlyMissing: true }
  )
}

export async function refreshMany(paths: string[]): Promise<MediaMetadataOpResult> {
  return runOnTargets('Updating media metadata…', paths, async (target) => {
    const existing = await readMediaMetadata(target)
    if (!existing || existing.source === 'plex') await extractOnePlex(target)
    else await downloadOneInternet(target)
    return true
  })
}

export async function clearMany(paths: string[]): Promise<MediaMetadataOpResult> {
  return runOnTargets('Clearing media metadata…', paths, async (target) => {
    const r = await clearMediaMetadata(target)
    if (!r.cleared) return false
    await invalidateColumnMetaPaths([target])
    return true
  })
}

export async function getMediaMetadataView(rawPath: string): Promise<{
  metadata: MediaMetadata | null
  thumbnailBase64: string | null
}> {
  const p = requireAbsolute(rawPath)
  const metadata = await readMediaMetadata(p)
  const thumb = metadata ? await readMediaThumbnail(p) : null
  return {
    metadata,
    thumbnailBase64: thumb ? thumb.toString('base64') : null
  }
}
