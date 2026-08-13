import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  FOLDER_STAT_FILE_COUNT,
  FOLDER_STAT_FILE_TOT_COUNT,
  FOLDER_STAT_FOLDER_COUNT,
  FOLDER_STAT_FOLDER_TOT_COUNT,
  FOLDER_STAT_TOTAL_SIZE,
  rollupFolderStats,
  type FolderStatCounts,
  type FolderStatisticsResult
} from '@shared/folderStats'
import { AppError } from '@shared/result'
import { requireAbsolute } from './list'
import { writeStreamText } from './adsWin32'
import { beginOp, type OpReporter } from './opProgress'
import { muteWatchers } from './watch'
import { dropColumnMetaMemoryPath, invalidateColumnMetaPaths } from '../meta/columns'

const STAT_CONCURRENCY = 32
/** Throttle status-bar updates during large tree walks. */
const PROGRESS_EVERY = 500
/** Batch disk meta-cache invalidation for tagged folders. */
const INVALIDATE_EVERY = 256

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
  lastDir: string
  pendingInvalidate: string[]
}

function formatWalkProgress(state: WalkState, stats: FolderStatCounts): string {
  const name = path.basename(state.lastDir) || state.lastDir
  return `${state.entriesScanned.toLocaleString()} scanned · ${state.foldersTagged.toLocaleString()} tagged · ${stats.fileTotCount.toLocaleString()} files · ${stats.folderTotCount.toLocaleString()} folders · ${formatBytesBrief(stats.totalSize)} — ${name}`
}

function reportProgress(state: WalkState, op: OpReporter, stats: FolderStatCounts, force = false): void {
  if (!force && state.entriesScanned > 0 && state.entriesScanned % PROGRESS_EVERY !== 0) return
  op.setDone(state.entriesScanned, formatWalkProgress(state, stats))
}

async function writeStatStream(dir: string, streamName: string, value: string): Promise<void> {
  try {
    await writeStreamText(dir, streamName, value)
  } catch (e) {
    throw new AppError(
      'io',
      `Could not write ADS stream “${streamName}” on “${dir}”: ${errMsg(e)}`
    )
  }
}

async function writeFolderStatStreams(dir: string, stats: FolderStatCounts): Promise<void> {
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

/** Depth-first walk: tag every folder with immediate + rolled-up statistics. */
async function tagFolderTree(dir: string, op: OpReporter, state: WalkState): Promise<FolderStatCounts> {
  op.throwIfCancelled()
  state.lastDir = dir
  muteWatchers(2500)

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

  const childStats: FolderStatCounts[] = []
  for (let i = 0; i < subdirs.length; i += STAT_CONCURRENCY) {
    op.throwIfCancelled()
    const batch = subdirs.slice(i, i + STAT_CONCURRENCY)
    const settled = await Promise.allSettled(batch.map((sub) => tagFolderTree(sub, op, state)))
    for (let j = 0; j < settled.length; j++) {
      const s = settled[j]!
      if (s.status === 'rejected') {
        throw s.reason instanceof AppError ? s.reason : new AppError('io', errMsg(s.reason))
      }
      childStats.push(s.value)
    }
  }

  const stats = rollupFolderStats({ files, folders, fileBytes }, childStats)
  await writeFolderStatStreams(dir, stats)
  trackFolderTagged(dir, state)
  await flushMetaInvalidation(state)
  reportProgress(state, op, stats)

  return stats
}

/** Walk a local folder tree and attach FileCount / FileTotCount / FolderCount / FolderTotCount / TotalSize ADS on every folder. */
export async function calculateFolderStatistics(inputPath: string): Promise<FolderStatisticsResult> {
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

  const label = `Calculating statistics — ${path.basename(root) || root}`
  const progress = beginOp('folder-stats', 0, label)
  muteWatchers(120_000)
  const state: WalkState = {
    entriesScanned: 0,
    foldersTagged: 0,
    lastDir: root,
    pendingInvalidate: []
  }

  try {
    progress.pulse('Scanning and tagging folders…')
    const stats = await tagFolderTree(root, progress, state)
    await flushMetaInvalidation(state, true)
    reportProgress(state, progress, stats, true)
    progress.finish()
    muteWatchers(800)
    return {
      path: root,
      ...stats,
      foldersTagged: state.foldersTagged
    }
  } catch (e) {
    progress.fail()
    muteWatchers(800)
    throw e
  }
}
