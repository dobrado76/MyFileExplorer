import fsp from 'node:fs/promises'
import path from 'node:path'
import { isMediaApiLimitError } from '@shared/mediaApiLimit'
import { AppError } from '@shared/result'
import {
  classifyMediaFromNames,
  isGenericMediaFolderName,
  isMediaMetadataVideoName,
  isSeasonFolderName,
  normalizeEpisodeFields,
  parseMediaFileName,
  type MediaMetadata,
  type MediaQueryKind
} from '@shared/mediaMetadata'
import { requireAbsolute } from '../fs/list'
import { beginOp } from '../fs/opProgress'
import { invalidateColumnMetaPaths } from '../meta/columns'
import { firstPortraitCover, isPortraitCoverBuffer } from './coverImage'
import { downloadFromInternet, downloadImage } from './internet'
import { downloadPlexThumb, extractFromPlex, probePlex } from './plex'
import {
  clearMediaMetadata,
  hasMediaMetadataContainer,
  readMediaMetadata,
  readMediaThumbnail,
  writeMediaMetadata
} from './store'

const MAX_WALK = 20_000
export type MediaMetadataOpResult = {
  done: number
  failed: { path: string; message: string }[]
  updated: string[]
  stoppedReason?: string
  needsKind?: { path: string; title: string }[]
}

export { probePlex }
export { listMediaCovers, setMediaCover } from './covers'

function isVideoName(name: string): boolean {
  return isMediaMetadataVideoName(name)
}

function folderSearchName(dir: string): string {
  const base = path.basename(dir)
  if (isSeasonFolderName(base)) {
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
  const seed = hit.thumbBytes && hit.thumbBytes.length > 0 ? hit.thumbBytes : null
  let thumb: Buffer | null = seed && (await isPortraitCoverBuffer(seed)) ? seed : null
  if (!thumb) {
    const urls = [...new Set([...(hit.thumbUrls ?? []), ...(hit.thumbUrl ? [hit.thumbUrl] : [])])]
    const landscape: Buffer[] = seed ? [seed] : []
    for (const url of urls) {
      const buf = await fetchThumb(url)
      if (!buf || buf.length < 32) continue
      if (await isPortraitCoverBuffer(buf)) {
        thumb = buf
        break
      }
      landscape.push(buf)
    }
    if (!thumb) thumb = await firstPortraitCover(landscape)
  }
  const prev = await readMediaMetadata(target)
  const filled = normalizeEpisodeFields(hit.meta, path.basename(target))
  const meta = prev?.watched != null ? { ...filled, watched: prev.watched } : filled
  await writeMediaMetadata(target, meta, meta.kind === 'episode' ? null : thumb)
  await invalidateColumnMetaPaths([target])
}

function asShowFolderMeta(meta: MediaMetadata, folderTitle?: string): MediaMetadata {
  if (meta.kind === 'show') {
    return folderTitle && !meta.title ? { ...meta, title: folderTitle } : meta
  }
  if (meta.kind !== 'episode') return meta
  return {
    ...meta,
    kind: 'show',
    title: meta.showTitle || folderTitle || meta.title,
    season: undefined,
    episode: undefined,
    showTitle: undefined
  }
}

async function classifyTarget(
  abs: string,
  hints?: Record<string, MediaQueryKind>
): Promise<MediaQueryKind | 'ambiguous'> {
  const hinted = hints?.[abs] ?? hints?.[abs.toLowerCase()]
  if (hinted) return hinted
  let st
  try {
    st = await fsp.stat(abs)
  } catch {
    return 'ambiguous'
  }
  if (st.isFile()) {
    let siblings: string[] = []
    try {
      siblings = await fsp.readdir(path.dirname(abs))
    } catch {
      /* name only */
    }
    return classifyMediaFromNames({
      name: path.basename(abs),
      isDirectory: false,
      childNames: siblings
    })
  }
  let children: string[] = []
  try {
    children = await fsp.readdir(abs)
  } catch {
    /* name only */
  }
  return classifyMediaFromNames({
    name: path.basename(abs),
    isDirectory: true,
    childNames: children
  })
}

async function extractOnePlex(target: string, queryKind: MediaQueryKind): Promise<void> {
  const st = await fsp.stat(target)
  if (st.isFile()) {
    const hit = await extractFromPlex(target, undefined, { skipPoster: queryKind === 'episode' })
    await applyHit(target, hit, downloadPlexThumb)
    return
  }
  const hint = parseMediaFileName(folderSearchName(target)).title
  if (queryKind === 'show') {
    try {
      const hit = await extractFromPlex(target, hint)
      hit.meta = asShowFolderMeta(hit.meta, hint)
      await applyHit(target, hit, downloadPlexThumb)
      return
    } catch {
      /* try first episode */
    }
  }
  const videos: string[] = []
  const folders = new Set<string>()
  await walkMediaTree(target, videos, folders)
  if (videos[0]) {
    try {
      const hit = await extractFromPlex(videos[0], hint, {
        skipPoster: queryKind === 'episode'
      })
      if (queryKind === 'show') hit.meta = asShowFolderMeta(hit.meta, hint)
      await applyHit(target, hit, downloadPlexThumb)
      return
    } catch {
      /* title search */
    }
  }
  const hit = await extractFromPlex(target, hint)
  if (queryKind === 'show') hit.meta = asShowFolderMeta(hit.meta, hint)
  await applyHit(target, hit, downloadPlexThumb)
}

async function downloadOneInternet(target: string, queryKind: MediaQueryKind): Promise<void> {
  const st = await fsp.stat(target)
  const name = st.isDirectory() ? folderSearchName(target) : path.basename(target)
  const parsed = parseMediaFileName(name)
  const hit = await downloadFromInternet(parsed, queryKind)
  if (st.isDirectory() && queryKind === 'show') {
    hit.meta = asShowFolderMeta(hit.meta, parsed.title)
  }
  await applyHit(target, hit, downloadImage)
}

async function runOnTargets(
  label: string,
  rawPaths: string[],
  each: (target: string, kind: MediaQueryKind) => Promise<boolean>,
  opts?: { onlyMissing?: boolean; kindHints?: Record<string, MediaQueryKind>; skipClassify?: boolean }
): Promise<MediaMetadataOpResult> {
  const expanded = await expandTargets(rawPaths)
  const unique = [...new Set([...expanded.videos, ...expanded.folders])]
  const failed: { path: string; message: string }[] = []
  const updated: string[] = []
  const needsKind: { path: string; title: string }[] = []
  let stoppedReason: string | undefined
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
        let kind: MediaQueryKind = 'movie'
        if (!opts?.skipClassify) {
          const classified = await classifyTarget(target, opts?.kindHints)
          if (classified === 'ambiguous') {
            needsKind.push({
              path: target,
              title: parseMediaFileName(folderSearchName(target)).title
            })
            op.tick(path.basename(target))
            continue
          }
          kind = classified
        }
        if (await each(target, kind)) updated.push(target)
      } catch (e) {
        if (e instanceof AppError && e.code === 'cancelled') throw e
        const message = e instanceof Error ? e.message : String(e)
        failed.push({ path: target, message })
        if (isMediaApiLimitError(e)) {
          stoppedReason = message
          break
        }
      }
      op.tick(path.basename(target))
    }
    op.finish()
  } catch (e) {
    op.fail()
    throw e
  }
  if (updated.length === 0 && failed.length > 0 && needsKind.length === 0) {
    throw new AppError(
      stoppedReason ? 'busy' : 'io',
      failed[0]!.message,
      undefined,
      failed[0]!.path
    )
  }
  return {
    done: updated.length,
    failed,
    updated,
    ...(stoppedReason ? { stoppedReason } : {}),
    ...(needsKind.length > 0 ? { needsKind } : {})
  }
}

export async function extractPlexMany(
  paths: string[],
  kindHints?: Record<string, MediaQueryKind>
): Promise<MediaMetadataOpResult> {
  return runOnTargets(
    'Extracting media metadata…',
    paths,
    async (target, kind) => {
      await extractOnePlex(target, kind)
      return true
    },
    { onlyMissing: true, kindHints }
  )
}

export async function downloadInternetMany(
  paths: string[],
  kindHints?: Record<string, MediaQueryKind>
): Promise<MediaMetadataOpResult> {
  return runOnTargets(
    'Downloading media metadata…',
    paths,
    async (target, kind) => {
      await downloadOneInternet(target, kind)
      return true
    },
    { onlyMissing: true, kindHints }
  )
}

export async function refreshMany(
  paths: string[],
  kindHints?: Record<string, MediaQueryKind>
): Promise<MediaMetadataOpResult> {
  return runOnTargets(
    'Updating media metadata…',
    paths,
    async (target, kind) => {
      const existing = await readMediaMetadata(target)
      if (!existing || existing.source === 'plex') await extractOnePlex(target, kind)
      else await downloadOneInternet(target, kind)
      return true
    },
    { kindHints }
  )
}

export async function clearMany(paths: string[]): Promise<MediaMetadataOpResult> {
  return runOnTargets(
    'Clearing media metadata…',
    paths,
    async (target) => {
      const r = await clearMediaMetadata(target)
      if (!r.cleared) return false
      await invalidateColumnMetaPaths([target])
      return true
    },
    { skipClassify: true }
  )
}

function showFolderForFile(filePath: string): string {
  const parent = path.dirname(filePath)
  return isSeasonFolderName(path.basename(parent)) ? path.dirname(parent) : parent
}

export async function getMediaMetadataView(rawPath: string): Promise<{
  metadata: MediaMetadata | null
  thumbnailBase64: string | null
}> {
  const p = requireAbsolute(rawPath)
  const raw = await readMediaMetadata(p)
  const metadata = raw ? normalizeEpisodeFields(raw, path.basename(p)) : null
  let thumb = metadata ? await readMediaThumbnail(p) : null
  if (metadata?.kind === 'episode' && (!thumb || thumb.length < 32)) {
    thumb = await readMediaThumbnail(showFolderForFile(p))
  }
  return {
    metadata,
    thumbnailBase64: thumb && thumb.length >= 32 ? thumb.toString('base64') : null
  }
}

export async function setWatchedMany(rawPaths: string[], watched: boolean): Promise<{ updated: string[] }> {
  const updated: string[] = []
  for (const raw of rawPaths) {
    const p = requireAbsolute(raw)
    const meta = await readMediaMetadata(p)
    if (!meta) continue
    if (meta.watched === watched) {
      updated.push(p)
      continue
    }
    await writeMediaMetadata(p, { ...meta, watched })
    await invalidateColumnMetaPaths([p])
    updated.push(p)
  }
  if (updated.length === 0) {
    throw new AppError('validation', 'No media metadata on the selection to mark')
  }
  return { updated }
}

export async function getFolderMediaLibrary(rawPath: string): Promise<{
  isContainer: boolean
  items: {
    path: string
    watched: boolean
    genres: string[]
    kind: MediaMetadata['kind']
    season?: number
    episode?: number
  }[]
}> {
  const dir = requireAbsolute(rawPath)
  if (dir.toLowerCase().startsWith('mfe-remote://')) {
    return { isContainer: false, items: [] }
  }
  const isContainer = await hasMediaMetadataContainer(dir)
  const parent = path.dirname(dir)
  const parentIsContainer =
    !isContainer && parent !== dir && (await hasMediaMetadataContainer(parent))
  if (!isContainer && !parentIsContainer) return { isContainer: false, items: [] }
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return { isContainer, items: [] }
  }
  const items: {
    path: string
    watched: boolean
    genres: string[]
    kind: MediaMetadata['kind']
    season?: number
    episode?: number
  }[] = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const full = path.join(dir, name)
    const meta = await readMediaMetadata(full)
    if (!meta) continue
    const ep = normalizeEpisodeFields(meta, name)
    items.push({
      path: full,
      watched: ep.watched === true,
      genres: ep.genres ?? [],
      kind: ep.kind,
      season: ep.season,
      episode: ep.episode
    })
  }
  return { isContainer, items }
}
