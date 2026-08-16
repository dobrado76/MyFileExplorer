import { describe, expect, it, vi } from 'vitest'
import {
  FOLDER_STAT_FILE_COUNT,
  FOLDER_STATS_COLUMN_IDS,
  FOLDER_STATS_STREAM_BY_COLUMN,
  parseFolderStatInt,
  completeTaggedChildStats,
  rollupFolderStats
} from '@shared/folderStats'
import {
  columnNeedsDirectoryMeta,
  filterDirectoryMetaFetchColumns,
  filterFileMetaFetchColumns,
  filterMetaFetchColumns,
  isDirectoryMetaColumn
} from '@shared/schemas/columns'
import { AppError } from '@shared/result'

vi.mock('../main/fs/winAttrs', () => ({
  pathIsReadOnly: vi.fn(() => false),
  pathIsHidden: vi.fn(() => false),
  getWinAttributeFlags: vi.fn(() => null)
}))

vi.mock('../main/settings/store', () => ({
  settingsStore: () => ({
    get: () => ({ viewFilterEnabled: true, viewFilterPatterns: [], folderStatsSkipPaths: [] })
  }),
  patchSettings: vi.fn()
}))

import {
  addFolderStatsSkipPath,
  folderStatsSkipPathKeys,
  isProtectedStatsDirName,
  isSkippedStatsPath,
  normalizeFolderStatsSkipPaths,
  removeFolderStatsSkipPath,
  shouldSkipFolderForStats
} from '../shared/folderStatsSkip'
import { folderStatWriteError, isFolderStatsCancelled } from '../main/fs/folderStats'
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

  it('completeTaggedChildStats fails closed on a missing child record', () => {
    const ok = {
      fileCount: 1,
      fileTotCount: 1,
      folderCount: 0,
      folderTotCount: 0,
      totalSize: 10
    }
    expect(completeTaggedChildStats([ok, ok])).toEqual([ok, ok])
    expect(completeTaggedChildStats([ok, null])).toBeNull()
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
    expect(isDirectoryMetaColumn('size', { showFolderStatistics: false })).toBe(false)
    expect(isDirectoryMetaColumn('fsFileCount', { showFolderStatistics: false })).toBe(false)
    expect(isDirectoryMetaColumn('ads', { showFolderStatistics: false })).toBe(true)
    expect(filterMetaFetchColumns(['size', 'ads', 'fsFileCount'], { showFolderStatistics: false })).toEqual(
      ['ads']
    )
    expect(filterFileMetaFetchColumns(['size', 'ads', 'dimensions', 'fsFileCount'])).toEqual([
      'ads',
      'dimensions'
    ])
    expect(filterDirectoryMetaFetchColumns(['size', 'mtime', 'fsFileCount', 'ads'])).toEqual([
      'size',
      'fsFileCount',
      'ads'
    ])
  })
})

describe('shouldSkipFolderForStats', () => {
  it('skips $RECYCLE.BIN and System Volume Information by name', () => {
    expect(isProtectedStatsDirName('$RECYCLE.BIN')).toBe(true)
    expect(isProtectedStatsDirName('System Volume Information')).toBe(true)
    expect(isProtectedStatsDirName('Music')).toBe(false)
  })

  it('always skips the System attribute', () => {
    expect(
      shouldSkipFolderForStats({
        name: 'Windows',
        system: true,
        hidden: false,
        hideHidden: false,
        filterMatch: false
      })
    ).toBe(true)
  })

  it('skips Hidden only when the view filter is on', () => {
    const hidden = {
      name: 'secret',
      system: false,
      hidden: true,
      hideHidden: false,
      filterMatch: false
    }
    expect(shouldSkipFolderForStats(hidden)).toBe(false)
    expect(shouldSkipFolderForStats({ ...hidden, hideHidden: true })).toBe(true)
  })

  it('skips view-filter matches', () => {
    expect(
      shouldSkipFolderForStats({
        name: 'node_modules',
        system: false,
        hidden: false,
        hideHidden: true,
        filterMatch: true
      })
    ).toBe(true)
  })
})

describe('folderStatsSkipPaths', () => {
  it('normalizes case, slashes, and duplicates', () => {
    expect(
      normalizeFolderStatsSkipPaths([
        'D:\\envs\\conda-meta',
        'd:/envs/conda-meta/',
        '  ',
        'E:\\other'
      ])
    ).toEqual(['D:\\envs\\conda-meta', 'E:\\other'])
  })

  it('matches skip keys case-insensitively', () => {
    const keys = folderStatsSkipPathKeys(['D:\\envs\\conda-meta'])
    expect(isSkippedStatsPath('d:/envs/conda-meta', keys)).toBe(true)
    expect(isSkippedStatsPath('D:\\envs\\other', keys)).toBe(false)
  })

  it('adds and removes a path', () => {
    const added = addFolderStatsSkipPath([], 'D:\\envs\\conda-meta')
    expect(added).toEqual(['D:\\envs\\conda-meta'])
    expect(removeFolderStatsSkipPath(added, 'd:\\envs\\conda-meta')).toEqual([])
  })
})

describe('isFolderStatsCancelled', () => {
  it('treats only cancelled AppErrors as abort-always', () => {
    expect(isFolderStatsCancelled(new AppError('cancelled', 'Cancelled'))).toBe(true)
    expect(isFolderStatsCancelled(new AppError('io', 'denied', undefined, 'C:\\locked'))).toBe(
      false
    )
    expect(isFolderStatsCancelled(new Error('nope'))).toBe(false)
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
    expect(err.message).toContain('Z:\\Music\\Stories')
    expect(err.message).toContain('Read-only')
    expect(err.message).not.toContain('EPERM')
    expect(err.path).toBe('Z:\\Music\\Stories')
  })

  it('maps EMFILE to a short retry hint', () => {
    vi.mocked(pathIsReadOnly).mockReturnValueOnce(false)
    const err = folderStatWriteError('C:\\mods\\config', 'FileCount', {
      code: 'EMFILE',
      message: 'EMFILE: too many open files'
    })
    expect(err.message).toContain('C:\\mods\\config')
    expect(err.message).toContain('too many files open')
    expect(err.message).not.toContain('EMFILE')
    expect(err.path).toBe('C:\\mods\\config')
  })

  it('maps EPERM without read-only to a permission hint', () => {
    vi.mocked(pathIsReadOnly).mockReturnValueOnce(false)
    const err = folderStatWriteError('C:\\locked', 'FileCount', { code: 'EPERM', message: 'nope' })
    expect(err.message).toContain('C:\\locked')
    expect(err.message).toContain('denied permission')
    expect(err.message).not.toContain('EPERM')
    expect(err.path).toBe('C:\\locked')
  })
})
