/** NTFS ADS stream names written by Calculate Statistics. */
export const FOLDER_STAT_FILE_COUNT = 'FileCount'
export const FOLDER_STAT_FILE_TOT_COUNT = 'FileTotCount'
export const FOLDER_STAT_FOLDER_COUNT = 'FolderCount'
export const FOLDER_STAT_FOLDER_TOT_COUNT = 'FolderTotCount'
export const FOLDER_STAT_TOTAL_SIZE = 'TotalSize'

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
  /** Folders skipped because TotalSize ADS already existed (skipTagged runs only). */
  foldersSkipped?: number
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
