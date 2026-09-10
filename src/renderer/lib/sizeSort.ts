import type { DirEntry } from '@shared/schemas/fs'

/**
 * Numeric byte key for Size-column sorting.
 * Files use listing size. Folders use ADS TotalSize digits when present
 * (listing size is always 0 for directories).
 */
export function entrySizeSortBytes(
  entry: Pick<DirEntry, 'kind' | 'size'>,
  folderTotalSizeDigits?: string | null
): number {
  if (entry.kind === 'dir') {
    if (folderTotalSizeDigits && /^\d+$/.test(folderTotalSizeDigits)) {
      const n = Number(folderTotalSizeDigits)
      return Number.isFinite(n) ? n : 0
    }
    return 0
  }
  return entry.size || 0
}
