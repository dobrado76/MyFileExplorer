import { describe, expect, it } from 'vitest'
import {
  COLUMN_GROUP_LABELS,
  MEDIA_METADATA_COLUMN_IDS,
  columnMeta,
  columnNeedsDirectoryMeta,
  isAsyncColumn,
  isDirectoryMetaColumn,
  isMediaMetadataColumnId
} from '../shared/schemas/columns'
import {
  formatMediaRatingsColumnValue,
  parseMediaRatingsColumnValue
} from '../shared/mediaMetadata'

describe('media metadata Details columns', () => {
  it('registers mm* ids under Media Metadata group', () => {
    expect(COLUMN_GROUP_LABELS.mediaMetadata).toBe('Media Metadata')
    for (const id of MEDIA_METADATA_COLUMN_IDS) {
      expect(isMediaMetadataColumnId(id)).toBe(true)
      expect(isAsyncColumn(id)).toBe(true)
      expect(columnNeedsDirectoryMeta(id)).toBe(true)
      expect(isDirectoryMetaColumn(id, { showFolderStatistics: false })).toBe(true)
      expect(columnMeta(id).group).toBe('mediaMetadata')
      expect(columnMeta(id).async).toBe(true)
    }
  })

  it('round-trips ratings column encoding', () => {
    const ratings = [
      { source: 'IMDb', value: 8.4, max: 10 },
      { source: 'Rotten Tomatoes', value: 94 }
    ]
    const encoded = formatMediaRatingsColumnValue(ratings)
    expect(parseMediaRatingsColumnValue(encoded)).toEqual(ratings)
    expect(parseMediaRatingsColumnValue('not-json')).toEqual([])
    expect(parseMediaRatingsColumnValue('')).toEqual([])
  })
})
