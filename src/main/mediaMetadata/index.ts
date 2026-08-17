import fsp from 'node:fs/promises'
import path from 'node:path'
import { isMediaApiLimitError } from '@shared/mediaApiLimit'
import { AppError } from '@shared/result'
import {
  classifyMediaFromNames,
  isGenericMediaFolderName,
  isMediaMetadataVideoName,
  isMediaTitleFolder,
  isMoviePartVideoName,
  isMultipartMovieFolder,
  isNeedsMediaPickError,
  isSeasonFolderName,
  normalizeEpisodeFields,
  parseMediaFileName,
  pickIdFromStored,
  type MediaMetadata,
  type MediaPickCandidate,
  type MediaQueryKind
} from '@shared/mediaMetadata'
import { isUnderPath, samePath } from '@shared/paths'
import { requireAbsolute } from '../fs/list'
import { beginOp } from '../fs/opProgress'
import { invalidateColumnMetaPaths } from '../meta/columns'
import { firstPortraitCover, isPortraitCoverBuffer } from './coverImage'
import { downloadFromInternet, downloadImage } from './internet'
import { downloadPlexThumb, extractFromPlex, probePlex } from './plex'
import {
  clearMediaMetadata,
  hasMediaMetadataContainer,
  hasMediaThumbnail,
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
  needsPick?: { path: string; title: string; candidates: MediaPickCandidate[] }[]
}

export { probePlex }
export { listMediaCovers, setMediaCover } from './covers'
export { consolidateSubtitles } from './subtitles'

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
  const skipParts = isMultipartMovieFolder(entries.map((e) => e.name))
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isFile() && isVideoName(e.name)) {
      hasVideoHere = true
      if (!skipParts) {
        videos.push(full)
        if (videos.length >= MAX_WALK) return
      }
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

function shouldWriteFolderMeta(
  dir: string,
  childFolders: string[],
  selectedRoots: string[]
): boolean {
  const parent = path.dirname(dir)
  const direct = childFolders.filter((f) => !samePath(f, dir) && samePath(path.dirname(f), dir))
  const nonSeason = direct.filter((f) => !isSeasonFolderName(path.basename(f)))
  return isMediaTitleFolder({
    name: path.basename(dir),
    parentName: path.basename(parent),
    parentIsSelectedRoot: selectedRoots.some((r) => samePath(r, parent)),
    nonSeasonChildFolderCount: nonSeason.length
  })
}

async function expandTargets(rawPaths: string[]): Promise<{ videos: string[]; folders: string[] }> {
  const videos: string[] = []
  const folderSet = new Set<string>()
  const selectedRoots: string[] = []
  for (const raw of rawPaths) {
    const p = requireAbsolute(raw)
    let st
    try {
      st = await fsp.stat(p)
    } catch {
      continue
    }
    if (st.isFile()) {
      if (isVideoName(p)) {
        try {
          const siblings = await fsp.readdir(path.dirname(p))
          if (isMultipartMovieFolder(siblings)) {
            folderSet.add(path.dirname(p))
            continue
          }
        } catch {
          /* name only */
        }
        videos.push(p)
      }
      continue
    }
    if (st.isDirectory()) {
      selectedRoots.push(p)
      await walkMediaTree(p, videos, folderSet)
      try {
        const kids = await fsp.readdir(p, { withFileTypes: true })
        for (const e of kids) {
          if (!e.isDirectory() || e.name.startsWith('.')) continue
          if (isGenericMediaFolderName(e.name) || isSeasonFolderName(e.name)) continue
          const full = path.join(p, e.name)
          if ([...folderSet].some((f) => samePath(f, full) || isUnderPath(f, full))) {
            folderSet.add(full)
          }
        }
      } catch {
        /* listing failed */
      }
    }
  }
  const allFolders = [...folderSet]
  const folders = allFolders.filter((d) => shouldWriteFolderMeta(d, allFolders, selectedRoots))
  return { videos: [...new Set(videos)], folders }
}

async function applyHit(
  target: string,
  hit: { meta: MediaMetadata; thumbUrl: string | null; thumbUrls?: string[]; thumbBytes?: Buffer | null },
  fetchThumb: (url: string) => Promise<Buffer | null>
): Promise<void> {
  const prev = await readMediaMetadata(target)
  const filled = normalizeEpisodeFields(hit.meta, path.basename(target))
  const meta = prev?.watched != null ? { ...filled, watched: prev.watched } : filled
  if (meta.kind === 'episode') {
    await writeMediaMetadata(target, meta, null)
    await invalidateColumnMetaPaths([target])
    return
  }
  const seed = hit.thumbBytes && hit.thumbBytes.length > 0 ? hit.thumbBytes : null
  let thumb: Buffer | null = seed
  if (!thumb) {
    const urls = [...new Set([...(hit.thumbUrls ?? []), ...(hit.thumbUrl ? [hit.thumbUrl] : [])])]
    const landscape: Buffer[] = []
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
  } else if (!(await isPortraitCoverBuffer(thumb))) {
    thumb = (await firstPortraitCover([thumb])) ?? thumb
  }
  await writeMediaMetadata(target, meta, thumb)
  await invalidateColumnMetaPaths([target])
  if (meta.kind === 'movie') {
    try {
      if ((await fsp.stat(target)).isDirectory()) await clearMoviePartFiles(target)
    } catch {
      /* ignore */
    }
  }
}

async function clearMoviePartFiles(dir: string): Promise<void> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return
  }
  if (!isMultipartMovieFolder(names)) return
  for (const n of names) {
    if (!isMoviePartVideoName(n)) continue
    const full = path.join(dir, n)
    await clearMediaMetadata(full)
    await invalidateColumnMetaPaths([full])
  }
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

async function firstVideoQuick(dir: string): Promise<string | null> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const subdirs: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.isFile() && isVideoName(e.name)) return path.join(dir, e.name)
    if (e.isDirectory()) subdirs.push(path.join(dir, e.name))
  }
  for (const sub of subdirs) {
    let kids: import('node:fs').Dirent[]
    try {
      kids = await fsp.readdir(sub, { withFileTypes: true })
    } catch {
      continue
    }
    const hit = kids.find((e) => e.isFile() && isVideoName(e.name))
    if (hit) return path.join(sub, hit.name)
  }
  return null
}

async function extractOnePlex(target: string, queryKind: MediaQueryKind): Promise<void> {
  const st = await fsp.stat(target)
  if (st.isFile()) {
    const hit = await extractFromPlex(target)
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
  const first = await firstVideoQuick(target)
  if (first) {
    try {
      const hit = await extractFromPlex(first, hint)
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

async function downloadOneInternet(
  target: string,
  queryKind: MediaQueryKind,
  pickId?: string
): Promise<void> {
  const st = await fsp.stat(target)
  const name = st.isDirectory() ? folderSearchName(target) : path.basename(target)
  const parsed = parseMediaFileName(name)
  const hit = await downloadFromInternet(parsed, queryKind, pickId)
  if (st.isDirectory() && queryKind === 'show') {
    hit.meta = asShowFolderMeta(hit.meta, parsed.title)
  }
  await applyHit(target, hit, downloadImage)
}

async function runOnTargets(
  label: string,
  rawPaths: string[],
  each: (target: string, kind: MediaQueryKind, pickId?: string) => Promise<boolean>,
  opts?: {
    onlyMissing?: boolean
    kindHints?: Record<string, MediaQueryKind>
    pickHints?: Record<string, string>
    skipClassify?: boolean
    concurrency?: number
  }
): Promise<MediaMetadataOpResult> {
  const expanded = await expandTargets(rawPaths)
  const unique = [...new Set([...expanded.folders, ...expanded.videos])]
  const failed: { path: string; message: string }[] = []
  const updated: string[] = []
  const needsKind: { path: string; title: string }[] = []
  const needsPick: { path: string; title: string; candidates: MediaPickCandidate[] }[] = []
  let stoppedReason: string | undefined
  const op = beginOp('media-metadata', unique.length, label)
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 1, 8))
  try {
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < unique.length) {
        if (stoppedReason) return
        const target = unique[next]!
        next += 1
        op.throwIfCancelled()
        try {
          if (opts?.onlyMissing) {
            const existing = await readMediaMetadata(target)
            if (existing) {
              const needsCover =
                existing.kind !== 'episode' && !(await hasMediaThumbnail(target))
              if (!needsCover) {
                op.tick(path.basename(target))
                continue
              }
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
          const pickId = opts?.pickHints?.[target] ?? opts?.pickHints?.[target.toLowerCase()]
          if (await each(target, kind, pickId)) updated.push(target)
        } catch (e) {
          if (e instanceof AppError && e.code === 'cancelled') throw e
          if (isNeedsMediaPickError(e)) {
            needsPick.push({
              path: target,
              title: parseMediaFileName(folderSearchName(target)).title,
              candidates: e.candidates
            })
            op.tick(path.basename(target))
            continue
          }
          const message = e instanceof Error ? e.message : String(e)
          failed.push({ path: target, message })
          if (isMediaApiLimitError(e)) {
            stoppedReason = message
            return
          }
        }
        op.tick(path.basename(target))
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, () => worker()))
    op.finish()
  } catch (e) {
    op.fail()
    throw e
  }
  if (
    updated.length === 0 &&
    failed.length > 0 &&
    needsKind.length === 0 &&
    needsPick.length === 0
  ) {
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
    ...(needsKind.length > 0 ? { needsKind } : {}),
    ...(needsPick.length > 0 ? { needsPick } : {})
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
    { onlyMissing: true, kindHints, concurrency: 6 }
  )
}

export async function downloadInternetMany(
  paths: string[],
  kindHints?: Record<string, MediaQueryKind>,
  pickHints?: Record<string, string>
): Promise<MediaMetadataOpResult> {
  return runOnTargets(
    'Downloading media metadata…',
    paths,
    async (target, kind, pickId) => {
      await downloadOneInternet(target, kind, pickId)
      return true
    },
    { onlyMissing: true, kindHints, pickHints }
  )
}

export async function refreshMany(
  paths: string[],
  kindHints?: Record<string, MediaQueryKind>,
  pickHints?: Record<string, string>
): Promise<MediaMetadataOpResult> {
  return runOnTargets(
    'Updating media metadata…',
    paths,
    async (target, kind, pickId) => {
      const existing = await readMediaMetadata(target)
      if (!existing || existing.source === 'plex') await extractOnePlex(target, kind)
      else await downloadOneInternet(target, kind, pickId ?? pickIdFromStored(existing))
      return true
    },
    { kindHints, pickHints, concurrency: 4 }
  )
}

export async function clearMany(paths: string[]): Promise<MediaMetadataOpResult> {
  return runOnTargets(
    'Clearing media metadata…',
    paths,
    async (target) => {
      const r = await clearMediaMetadata(target)
      try {
        if ((await fsp.stat(target)).isDirectory()) await clearMoviePartFiles(target)
      } catch {
        /* ignore */
      }
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
    title?: string
    showTitle?: string
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
    title?: string
    showTitle?: string
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
      episode: ep.episode,
      title: ep.title,
      showTitle: ep.showTitle
    })
  }
  return { isContainer, items }
}
