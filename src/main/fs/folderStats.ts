import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  FOLDER_STAT_FILE_COUNT,
  FOLDER_STAT_FILE_TOT_COUNT,
  FOLDER_STAT_FOLDER_COUNT,
  FOLDER_STAT_FOLDER_TOT_COUNT,
  FOLDER_STAT_TOTAL_SIZE,
  parseFolderStatInt,
  rollupFolderStats,
  type FolderStatCounts,
  type FolderStatisticsResult
} from '@shared/folderStats'
import { AppError } from '@shared/result'
import { requireAbsolute } from './list'
import { readStreamText, writeStreamText } from './adsWin32'
import { beginOp, type OpReporter } from './opProgress'
import { muteWatchers } from './watch'
import { dropColumnMetaMemoryPath, invalidateColumnMetaPaths } from '../meta/columns'
import { pathIsReadOnly } from './winAttrs'

const STAT_CONCURRENCY = 32
/** Throttle status-bar updates during large tree walks. */
const PROGRESS_EVERY = 500
/** Batch disk meta-cache invalidation for tagged folders. */
const INVALIDATE_EVERY = 256

export type CalculateFolderStatisticsOptions = {
  /** Skip folders that already have a valid TotalSize ADS stream (Shift+click). */
  skipTagged?: boolean
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
  entriesScanned: number
  foldersTagged: number
  foldersSkipped: number
  lastDir: string
  pendingInvalidate: string[]
  skipTagged: boolean
}

type TagResult = {
  stats: FolderStatCounts
  /** This folder or a descendant was written this run. */
  dirty: boolean
}

function formatWalkProgress(state: WalkState, stats: FolderStatCounts): string {
  const name = path.basename(state.lastDir) || state.lastDir
  const skip =
    state.skipTagged && state.foldersSkipped > 0
      ? ` · ${state.foldersSkipped.toLocaleString()} skipped`
      : ''
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

async function hasValidTotalSizeStream(dir: string): Promise<boolean> {
  return (await readStatStreamInt(dir, FOLDER_STAT_TOTAL_SIZE)) != null
}

async function readFolderStatsFromAds(dir: string): Promise<FolderStatCounts | null> {
  const [fileCount, fileTotCount, folderCount, folderTotCount, totalSize] = await Promise.all([
    readStatStreamInt(dir, FOLDER_STAT_FILE_COUNT),
    readStatStreamInt(dir, FOLDER_STAT_FILE_TOT_COUNT),
    readStatStreamInt(dir, FOLDER_STAT_FOLDER_COUNT),
    readStatStreamInt(dir, FOLDER_STAT_FOLDER_TOT_COUNT),
    readStatStreamInt(dir, FOLDER_STAT_TOTAL_SIZE)
  ])
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

async function trySkipTaggedFolder(
  dir: string,
  state: WalkState,
  op: OpReporter
): Promise<TagResult | null> {
  if (!state.skipTagged) return null
  if (!(await hasValidTotalSizeStream(dir))) return null
  const existing = await readFolderStatsFromAds(dir)
  if (!existing) return null
  state.foldersSkipped++
  reportProgress(state, op, existing)
  return { stats: existing, dirty: false }
}

async function allSubdirsTagged(subdirs: readonly string[]): Promise<boolean> {
  if (subdirs.length === 0) return false
  for (let i = 0; i < subdirs.length; i += STAT_CONCURRENCY) {
    const batch = subdirs.slice(i, i + STAT_CONCURRENCY)
    const tagged = await Promise.all(batch.map((sub) => hasValidTotalSizeStream(sub)))
    if (tagged.some((t) => !t)) return false
  }
  return true
}

async function readTaggedSubtreeStats(
  subdirs: readonly string[],
  state: WalkState
): Promise<FolderStatCounts[]> {
  const out: FolderStatCounts[] = []
  for (let i = 0; i < subdirs.length; i += STAT_CONCURRENCY) {
    const batch = subdirs.slice(i, i + STAT_CONCURRENCY)
    const stats = await Promise.all(batch.map((sub) => readFolderStatsFromAds(sub)))
    for (let j = 0; j < stats.length; j++) {
      const s = stats[j]!
      if (!s) {
        throw new AppError('io', `Incomplete statistics on tagged folder “${batch[j]}”`)
      }
      state.foldersSkipped++
      out.push(s)
    }
  }
  return out
}

function errCode(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    return (e as { code: string }).code
  }
  return null
}

function folderDisplayName(dir: string): string {
  return path.basename(dir) || dir
}

/** User-facing error when ADS statistics cannot be written on a folder. */
export function folderStatWriteError(dir: string, streamName: string, e: unknown): AppError {
  if (pathIsReadOnly(dir)) {
    const name = folderDisplayName(dir)
    return new AppError(
      'io',
      `Could not save statistics on “${name}”: the folder is Read-only. Open Properties, clear Read-only (apply to this folder only), then try again.`
    )
  }
  const code = errCode(e)
  if (code === 'EPERM' || code === 'EACCES') {
    const name = folderDisplayName(dir)
    return new AppError(
      'io',
      `Could not save statistics on “${name}”: Windows denied permission. Check Properties → Security for this folder.`
    )
  }
  return new AppError(
    'io',
    `Could not write statistics stream “${streamName}” on “${dir}”: ${errMsg(e)}`
  )
}

async function assertFolderWritableForStats(dir: string): Promise<void> {
  if (pathIsReadOnly(dir)) {
    throw folderStatWriteError(dir, FOLDER_STAT_FILE_COUNT, null)
  }
}

async function writeStatStream(dir: string, streamName: string, value: string): Promise<void> {
  try {
    await writeStreamText(dir, streamName, value)
  } catch (e) {
    throw folderStatWriteError(dir, streamName, e)
  }
}

async function writeFolderStatStreams(dir: string, stats: FolderStatCounts): Promise<void> {
  await assertFolderWritableForStats(dir)
  await Promise.all([
    writeStatStream(dir, FOLDER_STAT_FILE_COUNT, String(stats.fileCount)),
    writeStatStream(dir, FOLDER_STAT_FILE_TOT_COUNT, String(stats.fileTotCount)),
    writeStatStream(dir, FOLDER_STAT_FOLDER_COUNT, String(stats.folderCount)),
    writeStatStream(dir, FOLDER_STAT_FOLDER_TOT_COUNT, String(stats.folderTotCount)),
    writeStatStream(dir, FOLDER_STAT_TOTAL_SIZE, String(stats.totalSize))
  ])
}

function trackFolderTagged(dir: string, state: WalkState): void {
  state.foldersTagged++
  dropColumnMetaMemoryPath(dir)
  state.pendingInvalidate.push(dir)
}

async function flushMetaInvalidation(state: WalkState, force = false): Promise<void> {
  if (state.pendingInvalidate.length === 0) return
  if (!force && state.pendingInvalidate.length < INVALIDATE_EVERY) return
  await invalidateColumnMetaPaths(state.pendingInvalidate)
  state.pendingInvalidate = []
}

async function scanImmediate(
  dir: string,
  state: WalkState
): Promise<{ files: number; folders: number; fileBytes: number; subdirs: string[] }> {
  let ents
  try {
    ents = await fsp.readdir(dir, { withFileTypes: true })
  } catch (e) {
    throw new AppError('io', `Cannot read folder “${dir}”: ${errMsg(e)}`)
  }

  let files = 0
  let folders = 0
  let fileBytes = 0
  const subdirs: string[] = []

  for (const e of ents) {
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) {
      folders++
      subdirs.push(path.join(dir, e.name))
    } else if (e.isFile()) {
      files++
      state.entriesScanned++
      try {
        const fst = await fsp.stat(path.join(dir, e.name))
        fileBytes += fst.size
      } catch {
        /* unreadable file — count it, skip size */
      }
    }
  }

  return { files, folders, fileBytes, subdirs }
}

async function loadChildStats(
  sub: string,
  op: OpReporter,
  state: WalkState
): Promise<FolderStatCounts> {
  if (state.skipTagged && (await hasValidTotalSizeStream(sub))) {
    const existing = await readFolderStatsFromAds(sub)
    if (existing) {
      state.foldersSkipped++
      return existing
    }
  }
  const child = await tagFolderTree(sub, op, state)
  return child.stats
}

/** Depth-first walk: tag folders with immediate + rolled-up statistics. */
async function tagFolderTree(dir: string, op: OpReporter, state: WalkState): Promise<TagResult> {
  op.throwIfCancelled()
  state.lastDir = dir
  muteWatchers(2500)

  const skipped = await trySkipTaggedFolder(dir, state, op)
  if (skipped) return skipped

  const { files, folders, fileBytes, subdirs } = await scanImmediate(dir, state)

  let childStats: FolderStatCounts[]
  if (state.skipTagged && subdirs.length > 0 && (await allSubdirsTagged(subdirs))) {
    // Every direct subfolder is tagged — read ADS only, never open those subtrees.
    childStats = await readTaggedSubtreeStats(subdirs, state)
    const done = await trySkipTaggedFolder(dir, state, op)
    if (done) return done
  } else {
    childStats = []
    for (let i = 0; i < subdirs.length; i += STAT_CONCURRENCY) {
      op.throwIfCancelled()
      const batch = subdirs.slice(i, i + STAT_CONCURRENCY)
      const settled = await Promise.allSettled(batch.map((sub) => loadChildStats(sub, op, state)))
      for (let j = 0; j < settled.length; j++) {
        const s = settled[j]!
        if (s.status === 'rejected') {
          throw s.reason instanceof AppError ? s.reason : new AppError('io', errMsg(s.reason))
        }
        childStats.push(s.value)
      }
    }
  }

  const stats = rollupFolderStats({ files, folders, fileBytes }, childStats)
  await writeFolderStatStreams(dir, stats)
  trackFolderTagged(dir, state)
  await flushMetaInvalidation(state)
  reportProgress(state, op, stats)

  return { stats, dirty: true }
}

/** Walk a local folder tree and attach FileCount / FileTotCount / FolderCount / FolderTotCount / TotalSize ADS. */
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
  const rootLabel = path.basename(root) || root
  const label = skipTagged
    ? `Calculating statistics (skip tagged) — ${rootLabel}`
    : `Calculating statistics — ${rootLabel}`
  const progress = beginOp('folder-stats', 0, label)
  muteWatchers(120_000)
  const state: WalkState = {
    entriesScanned: 0,
    foldersTagged: 0,
    foldersSkipped: 0,
    lastDir: root,
    pendingInvalidate: [],
    skipTagged
  }

  try {
    progress.pulse(skipTagged ? 'Scanning untagged folders…' : 'Scanning and tagging folders…')
    const { stats } = await tagFolderTree(root, progress, state)
    await flushMetaInvalidation(state, true)
    reportProgress(state, progress, stats, true)
    progress.finish()
    muteWatchers(800)
    return {
      path: root,
      ...stats,
      foldersTagged: state.foldersTagged,
      ...(skipTagged ? { foldersSkipped: state.foldersSkipped } : {})
    }
  } catch (e) {
    progress.fail()
    muteWatchers(800)
    throw e
  }
}
