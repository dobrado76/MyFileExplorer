import { describe, expect, it, vi } from 'vitest'
import {
  FOLDER_STAT_FILE_COUNT,
  FOLDER_STATS_COLUMN_IDS,
  FOLDER_STATS_STREAM_BY_COLUMN,
  parseFolderStatInt,
  rollupFolderStats
} from '@shared/folderStats'
import { columnNeedsDirectoryMeta, filterMetaFetchColumns, isDirectoryMetaColumn } from '@shared/schemas/columns'
import { AppError } from '@shared/result'

vi.mock('../main/fs/winAttrs', () => ({
  pathIsReadOnly: vi.fn(() => false)
}))

import { folderStatWriteError } from '../main/fs/folderStats'
import { pathIsReadOnly } from '../main/fs/winAttrs'

describe('folderStats streams', () => {
  it('maps column ids to ADS stream names', () => {
    expect(FOLDER_STATS_STREAM_BY_COLUMN.fsFileCount).toBe(FOLDER_STAT_FILE_COUNT)
    expect(FOLDER_STATS_STREAM_BY_COLUMN.fsFileTotCount).toBe('FileTotCount')
    expect(FOLDER_STATS_STREAM_BY_COLUMN.fsFolderCount).toBe('FolderCount')
    expect(FOLDER_STATS_STREAM_BY_COLUMN.fsFolderTotCount).toBe('FolderTotCount')
    expect(FOLDER_STATS_COLUMN_IDS).toHaveLength(4)
  })

  it('parseFolderStatInt accepts non-negative decimal integers', () => {
    expect(parseFolderStatInt('0')).toBe(0)
    expect(parseFolderStatInt(' 1234567890 ')).toBe(1234567890)
    expect(parseFolderStatInt('')).toBe(null)
    expect(parseFolderStatInt('12.3')).toBe(null)
    expect(parseFolderStatInt('-1')).toBe(null)
    expect(parseFolderStatInt('abc')).toBe(null)
    expect(parseFolderStatInt(null)).toBe(null)
  })

  it('rollupFolderStats adds immediate counts to child subtree totals', () => {
    const root = rollupFolderStats(
      { files: 2, folders: 1, fileBytes: 100 },
      [
        { fileCount: 3, folderCount: 0, fileTotCount: 3, folderTotCount: 0, totalSize: 50 },
        { fileCount: 0, folderCount: 2, fileTotCount: 5, folderTotCount: 3, totalSize: 200 }
      ]
    )
    expect(root).toEqual({
      fileCount: 2,
      folderCount: 1,
      fileTotCount: 10,
      folderTotCount: 4,
      totalSize: 350
    })
  })

  it('folder stat columns need directory metadata', () => {
    for (const id of FOLDER_STATS_COLUMN_IDS) {
      expect(columnNeedsDirectoryMeta(id)).toBe(true)
    }
    expect(columnNeedsDirectoryMeta('ads')).toBe(true)
    expect(isDirectoryMetaColumn('size')).toBe(true)
    expect(columnNeedsDirectoryMeta('mtime')).toBe(false)
  })
})

describe('folderStatWriteError', () => {
  it('maps EPERM on a read-only folder to a clear message', () => {
    vi.mocked(pathIsReadOnly).mockReturnValueOnce(true)
    const err = folderStatWriteError('Z:\\Music\\Stories', 'FileCount', {
      code: 'EPERM',
      message: "EPERM: operation not permitted, open 'Z:\\\\Music\\\\Stories:FileCount:$DATA'"
    })
    expect(err).toBeInstanceOf(AppError)
    expect(err.message).toContain('Read-only')
    expect(err.message).not.toContain('EPERM')
  })

  it('maps EPERM without read-only to a permission hint', () => {
    vi.mocked(pathIsReadOnly).mockReturnValueOnce(false)
    const err = folderStatWriteError('C:\\locked', 'FileCount', { code: 'EPERM', message: 'nope' })
    expect(err.message).toContain('denied permission')
    expect(err.message).not.toContain('EPERM')
  })
})
