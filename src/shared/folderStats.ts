/** NTFS ADS stream names written by Calculate Statistics. */
export const FOLDER_STAT_FILE_COUNT = 'FileCount'
export const FOLDER_STAT_FILE_TOT_COUNT = 'FileTotCount'
export const FOLDER_STAT_FOLDER_COUNT = 'FolderCount'
export const FOLDER_STAT_FOLDER_TOT_COUNT = 'FolderTotCount'
export const FOLDER_STAT_TOTAL_SIZE = 'TotalSize'
/** UTF-8 JSON: category breakdown, leaves/clump, newest content (see folderStatsPreview). */
export const FOLDER_STAT_PREVIEW = 'FolderStatsPreview'

export const FOLDER_STATS_CATEGORY_KEYS = [
  'images',
  'videos',
  'documents',
  'archives',
  'other'
] as const

export type FolderStatsCategoryKey = (typeof FOLDER_STATS_CATEGORY_KEYS)[number]

export type FolderStatsCategoryStat = {
  count: number
  bytes: number
}

/** One file represented in the space map / largest list. */
export type FolderStatsLeaf = {
  /** Path relative to the tagged folder root (complete — never truncated). */
  relativePath: string
  name: string
  size: number
  /** Lowercase extension without dot; '' if none. */
  ext: string
}

export type FolderStatsRecentEntry = {
  name: string
  relativePath: string
  mtimeMs: number
  isDir: boolean
}

export type FolderStatsPreviewPayload = {
  version: 1
  calculatedAtMs: number
  categories: Record<FolderStatsCategoryKey, FolderStatsCategoryStat>
  topExtensions: { ext: string; count: number }[]
  largest: FolderStatsLeaf[]
  recent: FolderStatsRecentEntry[]
  /** Max mtime under the tree — UI label “Newest content”. */
  newestMtimeMs: number
  leaves: FolderStatsLeaf[]
  clump: { size: number; fileCount: number } | null
  /** Effective N written (may be lower than the setting if JSON was capped). */
  maxLeaves: number
}

export const FOLDER_STATS_COLUMN_IDS = [
  'fsFileCount',
  'fsFileTotCount',
  'fsFolderCount',
  'fsFolderTotCount'
] as const

export type FolderStatsColumnId = (typeof FOLDER_STATS_COLUMN_IDS)[number]

export const FOLDER_STATS_STREAM_BY_COLUMN: Record<FolderStatsColumnId, string> = {
  fsFileCount: FOLDER_STAT_FILE_COUNT,
  fsFileTotCount: FOLDER_STAT_FILE_TOT_COUNT,
  fsFolderCount: FOLDER_STAT_FOLDER_COUNT,
  fsFolderTotCount: FOLDER_STAT_FOLDER_TOT_COUNT
}

export type FolderStatCounts = {
  fileCount: number
  folderCount: number
  fileTotCount: number
  folderTotCount: number
  totalSize: number
}

/** Preview model attachment: integers + JSON payload. */
export type FolderStatsPreviewModel = FolderStatsPreviewPayload &
  FolderStatCounts & {
    /** Host folder Date modified (for staleness vs calculatedAtMs). */
    folderMtimeMs: number
  }

/**
 * Shift+click fast path: every child must have a complete 5-stream record.
 * Any gap → null (caller retags; do not abort the walk).
 */
export function completeTaggedChildStats(
  rows: readonly (FolderStatCounts | null)[]
): FolderStatCounts[] | null {
  const out: FolderStatCounts[] = []
  for (const s of rows) {
    if (!s) return null
    out.push(s)
  }
  return out
}

/** Roll immediate counts + child subtree totals into this folder's statistics. */
export function rollupFolderStats(
  immediate: { files: number; folders: number; fileBytes: number },
  children: readonly FolderStatCounts[]
): FolderStatCounts {
  let fileTotCount = immediate.files
  let folderTotCount = immediate.folders
  let totalSize = immediate.fileBytes
  for (const c of children) {
    fileTotCount += c.fileTotCount
    folderTotCount += c.folderTotCount
    totalSize += c.totalSize
  }
  return {
    fileCount: immediate.files,
    folderCount: immediate.folders,
    fileTotCount,
    folderTotCount,
    totalSize
  }
}

export type FolderStatisticsResult = FolderStatCounts & {
  path: string
  /** Folders that received ADS streams (includes the root). */
  foldersTagged: number
  /** Folders not entered: already tagged, system / hidden / view-filter, skip list, or Skip all. */
  foldersSkipped?: number
  /**
   * Ancestors rewritten by rolling up child ADS (no deep re-walk).
   * Stops at the first parent without existing complete statistics.
   */
  parentsUpdated?: number
  /** Absolute paths of those ancestors (UI cache bust). */
  propagatedPaths?: string[]
  truncated?: boolean
}

/** Parse a decimal integer folder-stat ADS value; rejects empty/non-digit. */
export function parseFolderStatInt(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const v = raw.trim()
  if (!/^\d+$/.test(v)) return null
  const n = Number(v)
  return Number.isSafeInteger(n) ? n : null
}
