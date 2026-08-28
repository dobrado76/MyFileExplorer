import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  FOLDER_STAT_FILE_COUNT,
  FOLDER_STAT_FILE_TOT_COUNT,
  FOLDER_STAT_FOLDER_COUNT,
  FOLDER_STAT_FOLDER_TOT_COUNT,
  FOLDER_STAT_PREVIEW,
  FOLDER_STAT_TOTAL_SIZE,
  parseFolderStatInt,
  rollupFolderStats,
  type FolderStatCounts,
  type FolderStatisticsResult,
  type FolderStatsPreviewPayload
} from '@shared/folderStats'
import {
  addImmediateFile,
  clampFolderStatsTreemapMaxLeaves,
  emptyPreviewMergeState,
  finalizePreviewPayload,
  mergeChildMergeState,
  parseFolderStatsPreviewJson,
  previewMergeStateFromPayload,
  shrinkPreviewPayloadForAds,
  type PreviewMergeState
} from '@shared/folderStatsPreview'
import {
  folderStatsSkipPathKeys,
  isSkippedStatsPath,
  normalizeFolderStatsSkipPaths,
  shouldSkipFolderForStats
} from '@shared/folderStatsSkip'
import { compilePathPatterns, type PathPatternPredicate } from '@shared/pathPatterns'
import { pathKey, samePath } from '@shared/paths'
import { AppError } from '@shared/result'
import { requireAbsolute } from './list'
import { readStreamText, withPreservedHostTimes, writeStreamText } from './adsWin32'
import { listDirectoryForStats, type StatsScanEntry } from './listWin32'
import { beginOp, type OpReporter } from './opProgress'
import { muteWatchers } from './watch'
import { dropColumnMetaMemoryPath, invalidateColumnMetaPaths } from '../meta/columns'
import { invalidatePreviewCache } from '../preview'
import { getWinAttributeFlags, pathIsHidden, pathIsReadOnly } from './winAttrs'
import { patchSettings, settingsStore } from '../settings/store'

/** Folder trees in flight — keep low so ADS writes do not exhaust process handles. */
const STAT_CONCURRENCY = 6
/** Throttle status-bar updates during large tree walks. */
const PROGRESS_EVERY = 500
/** Batch disk meta-cache invalidation for tagged folders. */
const INVALIDATE_EVERY = 256

export type CalculateFolderStatisticsOptions = {
  /** Skip folders that already have a valid TotalSize ADS stream (Shift+click). */
  skipTagged?: boolean
  /** Keep walking when a folder cannot be read or tagged; persist those paths. */
  skipOnError?: boolean
  /** Override settings.folderStatsTreemapMaxLeaves for this run. */
  treemapMaxLeaves?: number
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

function formatBytesBrief(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let u = -1
  do {
    v /= 1024
    u++
  } while (v >= 1024 && u < units.length - 1)
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`
}

type WalkState = {
  root: string
  entriesScanned: number
  foldersTagged: number
  foldersSkipped: number
  lastDir: string
  pendingInvalidate: string[]
  skipTagged: boolean
  skipOnError: boolean
  hideHidden: boolean
  filterMatch: PathPatternPredicate
  skipPathKeys: Set<string>
  errorSkipPaths: string[]
  maxLeaves: number
}

type ChildTagged = {
  path: string
  stats: FolderStatCounts
  merge: PreviewMergeState
  dirty: boolean
}

type TaggedResult = ChildTagged & { skipped?: false }

type TagResult = TaggedResult | { skipped: true }

export function isFolderStatsCancelled(e: unknown): boolean {
  return e instanceof AppError && e.code === 'cancelled'
}

function wrapFolderStatsError(e: unknown): AppError {
  return e instanceof AppError ? e : new AppError('io', errMsg(e))
}

function rememberErrorSkip(state: WalkState, absPath: string): void {
  state.foldersSkipped++
  const key = pathKey(absPath)
  if (state.skipPathKeys.has(key)) return
  state.skipPathKeys.add(key)
  state.errorSkipPaths.push(absPath)
}

function persistErrorSkips(state: WalkState): void {
  if (state.errorSkipPaths.length === 0) return
  const cur = settingsStore().get().folderStatsSkipPaths ?? []
  patchSettings({
    folderStatsSkipPaths: normalizeFolderStatsSkipPaths([...cur, ...state.errorSkipPaths])
  })
}

function formatWalkProgress(state: WalkState, stats: FolderStatCounts): string {
  const name = path.basename(state.lastDir) || state.lastDir
  const skip =
    state.foldersSkipped > 0 ? ` · ${state.foldersSkipped.toLocaleString()} skipped` : ''
  return `${state.entriesScanned.toLocaleString()} scanned · ${state.foldersTagged.toLocaleString()} tagged${skip} · ${stats.fileTotCount.toLocaleString()} files · ${stats.folderTotCount.toLocaleString()} folders · ${formatBytesBrief(stats.totalSize)} — ${name}`
}

function reportProgress(state: WalkState, op: OpReporter, stats: FolderStatCounts, force = false): void {
  if (!force && state.entriesScanned > 0 && state.entriesScanned % PROGRESS_EVERY !== 0) return
  op.setDone(state.entriesScanned, formatWalkProgress(state, stats))
}

async function readStatStreamInt(dir: string, streamName: string): Promise<number | null> {
  try {
    const raw = await readStreamText(dir, streamName)
    return parseFolderStatInt(raw)
  } catch {
    return null
  }
}

async function readFolderStatsIntsFromAds(dir: string): Promise<FolderStatCounts | null> {
  const fileCount = await readStatStreamInt(dir, FOLDER_STAT_FILE_COUNT)
  const fileTotCount = await readStatStreamInt(dir, FOLDER_STAT_FILE_TOT_COUNT)
  const folderCount = await readStatStreamInt(dir, FOLDER_STAT_FOLDER_COUNT)
  const folderTotCount = await readStatStreamInt(dir, FOLDER_STAT_FOLDER_TOT_COUNT)
  const totalSize = await readStatStreamInt(dir, FOLDER_STAT_TOTAL_SIZE)
  if (
    fileCount == null ||
    fileTotCount == null ||
    folderCount == null ||
    folderTotCount == null ||
    totalSize == null
  ) {
    return null
  }
  return { fileCount, fileTotCount, folderCount, folderTotCount, totalSize }
}

async function readFolderStatsPreviewFromAds(dir: string): Promise<FolderStatsPreviewPayload | null> {
  try {
    const raw = await readStreamText(dir, FOLDER_STAT_PREVIEW)
    return parseFolderStatsPreviewJson(raw)
  } catch {
    return null
  }
}

/**
 * Complete tagged folder: five ints + valid FolderStatsPreview JSON.
 * When `requiredMaxLeaves` is set (Shift+skip), also require matching `maxLeaves`
 * so changing the space-map setting forces a retag.
 */
async function readCompleteTaggedFolder(
  dir: string,
  requiredMaxLeaves?: number
): Promise<{ stats: FolderStatCounts; preview: FolderStatsPreviewPayload } | null> {
  const stats = await readFolderStatsIntsFromAds(dir)
  if (!stats) return null
  const preview = await readFolderStatsPreviewFromAds(dir)
  if (!preview) return null
  if (requiredMaxLeaves != null && preview.maxLeaves !== requiredMaxLeaves) return null
  return { stats, preview }
}

async function trySkipTaggedFolder(
  dir: string,
  state: WalkState,
  op: OpReporter
): Promise<TaggedResult | null> {
  if (!state.skipTagged) return null
  const existing = await readCompleteTaggedFolder(dir, state.maxLeaves)
  if (!existing) return null
  state.foldersSkipped++
  reportProgress(state, op, existing.stats)
  return {
    path: dir,
    stats: existing.stats,
    merge: previewMergeStateFromPayload(existing.preview),
    dirty: false
  }
}

/** Shift+click: use ADS for every child only when ints + preview are complete. */
async function tryReadAllTaggedChildren(
  subdirs: readonly string[],
  state: WalkState
): Promise<ChildTagged[] | null> {
  if (!state.skipTagged || subdirs.length === 0) return null
  const rows: (ChildTagged | null)[] = []
  for (let i = 0; i < subdirs.length; i += STAT_CONCURRENCY) {
    const batch = subdirs.slice(i, i + STAT_CONCURRENCY)
    const batchRows = await Promise.all(
      batch.map(async (sub) => {
        const existing = await readCompleteTaggedFolder(sub, state.maxLeaves)
        if (!existing) return null
        return {
          path: sub,
          stats: existing.stats,
          merge: previewMergeStateFromPayload(existing.preview),
          dirty: false
        } satisfies ChildTagged
      })
    )
    rows.push(...batchRows)
  }
  if (rows.some((r) => !r)) return null
  state.foldersSkipped += rows.length
  return rows as ChildTagged[]
}

function errCode(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    return (e as { code: string }).code
  }
  return null
}

/** User-facing error when ADS statistics cannot be written on a folder. */
export function folderStatWriteError(dir: string, streamName: string, e: unknown): AppError {
  if (pathIsReadOnly(dir)) {
    return new AppError(
      'io',
      `Could not save statistics on “${dir}”: the folder is Read-only. Open Properties, clear Read-only (apply to this folder only), then try again.`,
      undefined,
      dir
    )
  }
  const code = errCode(e)
  if (code === 'EMFILE') {
    return new AppError(
      'io',
      `Could not save statistics on “${dir}”: too many files open at once. Try again.`,
      undefined,
      dir
    )
  }
  if (code === 'EPERM' || code === 'EACCES') {
    return new AppError(
      'io',
      `Could not save statistics on “${dir}”: Windows denied permission. Check Properties → Security for this folder.`,
      undefined,
      dir
    )
  }
  return new AppError(
    'io',
    `Could not write statistics stream “${streamName}” on “${dir}”: ${errMsg(e)}`,
    undefined,
    dir
  )
}

async function assertFolderWritableForStats(dir: string): Promise<void> {
  if (pathIsReadOnly(dir)) {
    throw folderStatWriteError(dir, FOLDER_STAT_FILE_COUNT, null)
  }
}

async function writeStatStream(dir: string, streamName: string, value: string): Promise<void> {
  try {
    await writeStreamText(dir, streamName, value, false, { preserveHostTimes: false })
  } catch (e) {
    if (errCode(e) === 'EMFILE') {
      await new Promise((r) => setTimeout(r, 40))
      try {
        await writeStreamText(dir, streamName, value, false, { preserveHostTimes: false })
        return
      } catch (e2) {
        throw folderStatWriteError(dir, streamName, e2)
      }
    }
    throw folderStatWriteError(dir, streamName, e)
  }
}

async function writeFolderStatStreams(
  dir: string,
  stats: FolderStatCounts,
  preview: FolderStatsPreviewPayload
): Promise<void> {
  await assertFolderWritableForStats(dir)
  const payload = shrinkPreviewPayloadForAds(preview, stats)
  const rows: [string, string][] = [
    [FOLDER_STAT_FILE_COUNT, String(stats.fileCount)],
    [FOLDER_STAT_FILE_TOT_COUNT, String(stats.fileTotCount)],
    [FOLDER_STAT_FOLDER_COUNT, String(stats.folderCount)],
    [FOLDER_STAT_FOLDER_TOT_COUNT, String(stats.folderTotCount)],
    [FOLDER_STAT_TOTAL_SIZE, String(stats.totalSize)],
    [FOLDER_STAT_PREVIEW, JSON.stringify(payload)]
  ]
  // One host-time snapshot for all streams — do not open them in parallel.
  await withPreservedHostTimes(dir, async () => {
    for (const [name, value] of rows) {
      await writeStatStream(dir, name, value)
    }
  })
}

function trackFolderTagged(dir: string, state: WalkState): void {
  state.foldersTagged++
  dropColumnMetaMemoryPath(dir)
  state.pendingInvalidate.push(dir)
}

async function flushMetaInvalidation(state: WalkState, force = false): Promise<void> {
  if (state.pendingInvalidate.length === 0) return
  if (!force && state.pendingInvalidate.length < INVALIDATE_EVERY) return
  const paths = state.pendingInvalidate
  state.pendingInvalidate = []
  await invalidateColumnMetaPaths(paths)
  invalidatePreviewCache(paths)
}

function skipStatsChild(
  absPath: string,
  state: WalkState,
  attrs?: { hidden: boolean; system: boolean }
): boolean {
  if (isSkippedStatsPath(absPath, state.skipPathKeys)) return true
  const flags = attrs ?? getWinAttributeFlags(absPath)
  return shouldSkipFolderForStats({
    name: path.basename(absPath),
    system: flags?.system === true,
    hidden: flags ? flags.hidden : pathIsHidden(absPath),
    hideHidden: state.hideHidden,
    filterMatch: state.filterMatch(absPath)
  })
}

type ImmediateScan = {
  files: number
  folders: number
  fileBytes: number
  subdirs: string[]
  fileEntries: { name: string; size: number; mtimeMs: number }[]
}

function foldStatsListing(listed: readonly StatsScanEntry[], state: WalkState): ImmediateScan {
  let files = 0
  let folders = 0
  let fileBytes = 0
  const subdirs: string[] = []
  const fileEntries: ImmediateScan['fileEntries'] = []
  for (const e of listed) {
    if (e.isReparse) continue
    if (e.isDir) {
      if (skipStatsChild(e.path, state, { hidden: e.hidden, system: e.system })) {
        state.foldersSkipped++
        continue
      }
      folders++
      subdirs.push(e.path)
    } else {
      files++
      state.entriesScanned++
      fileBytes += e.size
      fileEntries.push({ name: e.name, size: e.size, mtimeMs: e.mtimeMs })
    }
  }
  return { files, folders, fileBytes, subdirs, fileEntries }
}

async function scanImmediate(dir: string, state: WalkState): Promise<ImmediateScan> {
  const listed = listDirectoryForStats(dir)
  if (listed) return foldStatsListing(listed, state)

  let ents
  try {
    ents = await fsp.readdir(dir, { withFileTypes: true })
  } catch (e) {
    throw new AppError('io', `Cannot read folder “${dir}”: ${errMsg(e)}`, undefined, dir)
  }

  let files = 0
  let folders = 0
  const subdirs: string[] = []
  for (const e of ents) {
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) {
      const full = path.join(dir, e.name)
      if (skipStatsChild(full, state)) {
        state.foldersSkipped++
        continue
      }
      folders++
      subdirs.push(full)
    } else if (e.isFile()) {
      files++
      state.entriesScanned++
    }
  }
  return { files, folders, fileBytes: 0, subdirs, fileEntries: [] }
}

async function loadChildStats(
  sub: string,
  op: OpReporter,
  state: WalkState
): Promise<ChildTagged | null> {
  if (state.skipTagged) {
    const existing = await readCompleteTaggedFolder(sub, state.maxLeaves)
    if (existing) {
      state.foldersSkipped++
      return {
        path: sub,
        stats: existing.stats,
        merge: previewMergeStateFromPayload(existing.preview),
        dirty: false
      }
    }
  }
  const child = await tagFolderTree(sub, op, state)
  return child.skipped ? null : child
}

/** Depth-first walk: tag folders with immediate + rolled-up statistics + preview JSON. */
async function tagFolderTree(dir: string, op: OpReporter, state: WalkState): Promise<TagResult> {
  op.throwIfCancelled()
  state.lastDir = dir
  muteWatchers(2500)

  const already = await trySkipTaggedFolder(dir, state, op)
  if (already) return already

  let files: number
  let folders: number
  let fileBytes: number
  let subdirs: string[]
  let fileEntries: ImmediateScan['fileEntries']
  try {
    ;({ files, folders, fileBytes, subdirs, fileEntries } = await scanImmediate(dir, state))
  } catch (e) {
    if (isFolderStatsCancelled(e) || !state.skipOnError || samePath(dir, state.root)) {
      throw wrapFolderStatsError(e)
    }
    rememberErrorSkip(state, e instanceof AppError && e.path ? e.path : dir)
    return { skipped: true }
  }

  let children = await tryReadAllTaggedChildren(subdirs, state)
  if (children) {
    const done = await trySkipTaggedFolder(dir, state, op)
    if (done) return done
  } else {
    children = []
    for (let i = 0; i < subdirs.length; i += STAT_CONCURRENCY) {
      op.throwIfCancelled()
      const batch = subdirs.slice(i, i + STAT_CONCURRENCY)
      const settled = await Promise.allSettled(batch.map((sub) => loadChildStats(sub, op, state)))
      for (let j = 0; j < settled.length; j++) {
        const s = settled[j]!
        if (s.status === 'rejected') {
          const reason = s.reason
          if (isFolderStatsCancelled(reason) || !state.skipOnError) {
            throw wrapFolderStatsError(reason)
          }
          rememberErrorSkip(state, reason instanceof AppError && reason.path ? reason.path : batch[j]!)
          continue
        }
        if (s.value) children.push(s.value)
      }
    }
    folders = children.length
  }

  const childStats = children.map((c) => c.stats)
  const stats = rollupFolderStats({ files, folders, fileBytes }, childStats)

  const merge = emptyPreviewMergeState()
  for (const f of fileEntries) {
    addImmediateFile(merge, f, state.maxLeaves)
  }
  for (const child of children) {
    mergeChildMergeState(merge, path.basename(child.path), child.merge, state.maxLeaves)
  }

  const preview = finalizePreviewPayload(merge, stats, state.maxLeaves, Date.now())
  try {
    await writeFolderStatStreams(dir, stats, preview)
  } catch (e) {
    if (isFolderStatsCancelled(e) || !state.skipOnError) {
      throw wrapFolderStatsError(e)
    }
    if (samePath(dir, state.root)) {
      reportProgress(state, op, stats)
      return { path: dir, stats, merge, dirty: false }
    }
    rememberErrorSkip(state, dir)
    return { skipped: true }
  }
  trackFolderTagged(dir, state)
  await flushMetaInvalidation(state)
  reportProgress(state, op, stats)

  return { path: dir, stats, merge, dirty: true }
}

/** Read ints + FolderStatsPreview for the preview pane (no walk). */
export async function readFolderStatsForPreview(
  dir: string,
  folderMtimeMs: number
): Promise<import('@shared/folderStats').FolderStatsPreviewModel | null> {
  const existing = await readCompleteTaggedFolder(dir)
  if (!existing) return null
  return {
    ...existing.preview,
    ...existing.stats,
    folderMtimeMs
  }
}

/** Walk a local folder tree and attach FileCount / FileTotCount / FolderCount / FolderTotCount / TotalSize / FolderStatsPreview ADS. */
export async function calculateFolderStatistics(
  inputPath: string,
  opts: CalculateFolderStatisticsOptions = {}
): Promise<FolderStatisticsResult> {
  const root = requireAbsolute(inputPath)
  if (root.toLowerCase().startsWith('mfe-remote://')) {
    throw new AppError('validation', 'Folder statistics require a local NTFS folder')
  }

  let st
  try {
    st = await fsp.stat(root)
  } catch (e) {
    throw new AppError('not-found', `Folder not found: ${errMsg(e)}`)
  }
  if (!st.isDirectory()) {
    throw new AppError('validation', 'Path is not a folder')
  }

  const skipTagged = opts.skipTagged === true
  const skipOnError = opts.skipOnError === true
  const settings = settingsStore().get()
  const hideHidden = settings.viewFilterEnabled === true
  const filterMatch = compilePathPatterns(hideHidden ? settings.viewFilterPatterns : [])
  const skipPathKeys = folderStatsSkipPathKeys(settings.folderStatsSkipPaths ?? [])
  const maxLeaves = clampFolderStatsTreemapMaxLeaves(
    opts.treemapMaxLeaves ?? settings.folderStatsTreemapMaxLeaves
  )
  if (isSkippedStatsPath(root, skipPathKeys)) {
    throw new AppError(
      'validation',
      `“${root}” is on the Calculate Statistics skip list. Remove it in Settings → Behavior to tag it.`,
      undefined,
      root
    )
  }
  const rootLabel = path.basename(root) || root
  const label = skipOnError
    ? `Calculating statistics (skip errors) — ${rootLabel}`
    : skipTagged
      ? `Calculating statistics (skip tagged) — ${rootLabel}`
      : `Calculating statistics — ${rootLabel}`
  const progress = beginOp('folder-stats', 0, label)
  muteWatchers(120_000)
  const state: WalkState = {
    root,
    entriesScanned: 0,
    foldersTagged: 0,
    foldersSkipped: 0,
    lastDir: root,
    pendingInvalidate: [],
    skipTagged,
    skipOnError,
    hideHidden,
    filterMatch,
    skipPathKeys,
    errorSkipPaths: [],
    maxLeaves
  }

  try {
    progress.pulse(
      skipOnError
        ? 'Scanning — skipping folders that fail…'
        : skipTagged
          ? 'Scanning untagged folders…'
          : 'Scanning and tagging folders…'
    )
    const tagged = await tagFolderTree(root, progress, state)
    if (tagged.skipped) {
      throw new AppError('io', `Could not calculate statistics for “${root}”`, undefined, root)
    }
    persistErrorSkips(state)
    await flushMetaInvalidation(state, true)
    reportProgress(state, progress, tagged.stats, true)
    progress.finish()
    muteWatchers(800)
    return {
      path: root,
      ...tagged.stats,
      foldersTagged: state.foldersTagged,
      ...(state.foldersSkipped > 0 ? { foldersSkipped: state.foldersSkipped } : {})
    }
  } catch (e) {
    persistErrorSkips(state)
    progress.fail()
    muteWatchers(800)
    throw e
  }
}
