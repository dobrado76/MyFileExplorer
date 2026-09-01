import { describe, expect, it } from 'vitest'
import {
  adsFieldColumnId,
  adsFieldDisplayLabel,
  adsFieldNamesFromColumnIds,
  columnMeta,
  columnNeedsDirectoryMeta,
  isAdsFieldColumnId,
  isAsyncColumn,
  isDirectoryMetaColumn,
  mergeAdsFieldColumnNames,
  mergeAdsFieldColumns,
  parseAdsFieldColumnName,
  sanitizeAdsFieldColumns,
  isCloudSyncAdsStreamName,
  streamValueMenuCandidateNames
} from '../shared/schemas/columns'
import { defaultSettings, settingsSchema } from '../shared/schemas/settings'

describe('adsField column ids', () => {
  it('parses and builds adsField:<name>', () => {
    expect(adsFieldColumnId('AUTOV2')).toBe('adsField:AUTOV2')
    expect(parseAdsFieldColumnName('adsField:AUTOV2')).toBe('AUTOV2')
    expect(isAdsFieldColumnId('adsField:AUTOV2')).toBe(true)
    expect(isAdsFieldColumnId('ads')).toBe(false)
    expect(parseAdsFieldColumnName('adsField:bad:name')).toBeNull()
    expect(parseAdsFieldColumnName('adsField:')).toBeNull()
  })

  it('treats stream-value columns as async directory meta', () => {
    const id = adsFieldColumnId('AUTOV2')
    expect(isAsyncColumn(id)).toBe(true)
    expect(columnNeedsDirectoryMeta(id)).toBe(true)
    expect(isDirectoryMetaColumn(id, { showFolderStatistics: false })).toBe(true)
    expect(columnMeta(id)).toMatchObject({
      id,
      label: 'AUTOV2',
      group: 'adsFields',
      async: true
    })
    expect(columnMeta(id, [{ stream: 'AUTOV2', label: 'AutoV2 hash' }]).label).toBe(
      'AutoV2 hash'
    )
  })

  it('sanitizes catalog names (legacy strings and { stream, label })', () => {
    expect(
      sanitizeAdsFieldColumns([' AUTOV2 ', 'autov2', 'bad:name', '', 'Caption', 12])
    ).toEqual([{ stream: 'AUTOV2' }, { stream: 'Caption' }])
    expect(
      sanitizeAdsFieldColumns([{ stream: 'AUTOV2', label: ' AutoV2 hash ' }, { name: 'Caption' }])
    ).toEqual([{ stream: 'AUTOV2', label: 'AutoV2 hash' }, { stream: 'Caption' }])
  })

  it('merges catalog lists without duplicating case variants', () => {
    expect(mergeAdsFieldColumnNames(['AUTOV2'], ['autov2', 'Caption'])).toEqual([
      'AUTOV2',
      'Caption'
    ])
    expect(
      mergeAdsFieldColumns([{ stream: 'AUTOV2' }], ['autov2', 'Caption'], [
        { stream: 'AUTOV2', label: 'Hash' }
      ])
    ).toEqual([{ stream: 'AUTOV2', label: 'Hash' }, { stream: 'Caption' }])
  })

  it('hides Windows Cloud Files / Dropbox sync streams from Stream values menu', () => {
    const cloud =
      '${3D0CE612-FDEE-43f7-8ACA-957BEC0CCBA0}.Metadata'
    expect(isCloudSyncAdsStreamName(cloud)).toBe(true)
    expect(isCloudSyncAdsStreamName('com.dropbox.attrs')).toBe(true)
    expect(isCloudSyncAdsStreamName('com.dropbox.ignored')).toBe(true)
    expect(isCloudSyncAdsStreamName('Zone.Identifier')).toBe(false)
    expect(isCloudSyncAdsStreamName('FileTotCount')).toBe(false)
    expect(
      streamValueMenuCandidateNames(
        [cloud, 'com.dropbox.attrs', 'FileTotCount', 'Zone.Identifier'],
        []
      )
    ).toEqual(['FileTotCount', 'Zone.Identifier'])
    // Already-visible noise stays so the user can untick it
    expect(streamValueMenuCandidateNames([cloud], [cloud])).toEqual([cloud])
  })

  it('uses stream name when display label is empty', () => {
    expect(adsFieldDisplayLabel([{ stream: 'AUTOV2' }], 'AUTOV2')).toBe('AUTOV2')
    expect(adsFieldDisplayLabel([{ stream: 'AUTOV2', label: 'Hash' }], 'autov2')).toBe('Hash')
  })

  it('keeps adsField columns in the layout without adding them to the catalog', () => {
    const parsed = settingsSchema.parse({
      ...defaultSettings,
      detailsColumns: [
        { id: 'mtime', width: 150 },
        { id: 'adsField:AUTOV2', width: 140 },
        { id: 'not-a-column', width: 80 }
      ]
    })
    expect(parsed.detailsColumns.map((c) => c.id)).toEqual(['mtime', 'adsField:AUTOV2'])
    expect(parsed.adsFieldColumns).toEqual([])
  })

  it('keeps user metadata meta: columns in the layout (D70)', () => {
    const parsed = settingsSchema.parse({
      ...defaultSettings,
      detailsColumns: [
        { id: 'mtime', width: 150 },
        { id: 'meta:mf_a83f71c2xy', width: 140 },
        { id: 'meta:not-valid', width: 100 },
        { id: 'not-a-column', width: 80 }
      ]
    })
    expect(parsed.detailsColumns.map((c) => c.id)).toEqual(['mtime', 'meta:mf_a83f71c2xy'])
  })

  it('does not invent catalog entries from folder stream names', () => {
    const parsed = settingsSchema.parse({
      ...defaultSettings,
      adsFieldColumns: [{ stream: 'AUTOV2', label: 'Hash' }],
      detailsColumns: [
        { id: 'mtime', width: 150 },
        { id: 'adsField:FileTotCount', width: 140 }
      ]
    })
    expect(parsed.adsFieldColumns).toEqual([{ stream: 'AUTOV2', label: 'Hash' }])
  })

  it('collects names from column ids', () => {
    expect(adsFieldNamesFromColumnIds(['mtime', 'adsField:AUTOV2', 'ads'])).toEqual(['AUTOV2'])
  })
})
