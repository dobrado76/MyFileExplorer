import { describe, expect, it } from 'vitest'
import {
  VIRTUAL_FOLDER_EXT,
  VIRTUAL_FOLDER_FORMAT,
  chooseVirtualFolderStoredPath,
  emptyVirtualFolderDocument,
  entryDisplayName,
  isVirtualFolderDocumentPath,
  isVirtualFolderExt,
  presentVirtualFolderAsDirEntry,
  virtualFolderDisplayName,
  virtualFolderDocumentDir,
  virtualFolderEntryDuplicateKey,
  virtualFolderProjectedMountPath,
  virtualFolderDocumentPathFromProjectedMount,
  virtualFolderStemFromFileName,
  nextVirtualFolderFileName,
  nextRealFolderName,
  virtualFolderDocumentStemBlocked,
  realFolderStemBlockedByVirtualFolder,
  resolveVirtualFolderEntryPath,
  serializeVirtualFolderDocument,
  beginVirtualFolderVisit,
  filterOutNestedVirtualFolderPeers,
  filterOutProjectedMountPeers,
  isEmbeddedVirtualFolderGroup,
  virtualFolderGroupRowPath,
  parseVirtualFolderGroupPath,
  getEntriesAtGroup,
  findEntryInTree,
  findParentGroupId,
  virtualFolderTreeListPath,
  virtualFolderEntryIdFromPath,
  takeEntriesFromTree,
  isVirtualFolderGroupAncestor,
  mapEntriesAtGroup,
  rebaseVirtualFolderEntriesToDocument,
  cloneVirtualFolderEntries
} from '@shared/virtualFolder'
import { parseVirtualFolderJson } from '@shared/schemas/virtualFolder'

describe('virtualFolder paths', () => {
  it('detects the extension', () => {
    expect(isVirtualFolderExt('Work.mfevirtual')).toBe(true)
    expect(isVirtualFolderExt('Work.MFEVIRTUAL')).toBe(true)
    expect(isVirtualFolderExt('Work.json')).toBe(false)
    expect(isVirtualFolderDocumentPath('D:\\Collections\\AI.mfevirtual')).toBe(true)
    expect(isVirtualFolderDocumentPath('D:\\Collections')).toBe(false)
  })

  it('presents Hidden .mfevirtual as a visible folder in MFE listings', () => {
    const presented = presentVirtualFolderAsDirEntry({
      name: 'Watch.mfevirtual',
      path: 'E:\\Movies\\Watch.mfevirtual',
      kind: 'file',
      size: 12,
      ext: 'mfevirtual',
      isHidden: true
    })
    expect(presented.kind).toBe('dir')
    expect(presented.isHidden).toBe(false)
    expect(presented.size).toBe(0)
  })

  it('derives display name and document dir', () => {
    expect(virtualFolderDisplayName('D:\\Collections\\Current AI Work.mfevirtual')).toBe(
      'Current AI Work'
    )
    expect(virtualFolderDocumentDir('D:\\Collections\\AI.mfevirtual')).toBe('D:\\Collections')
    expect(virtualFolderDocumentDir('D:\\AI.mfevirtual')).toBe('D:\\')
  })

  it('prefers relative paths inside the document tree', () => {
    const doc = 'D:\\Project\\Refs.mfevirtual'
    expect(chooseVirtualFolderStoredPath(doc, 'D:\\Project\\docs\\a.pdf')).toEqual({
      path: 'docs/a.pdf',
      relative: true
    })
    expect(chooseVirtualFolderStoredPath(doc, 'F:\\Other\\x.bin')).toEqual({
      path: 'F:\\Other\\x.bin',
      relative: false
    })
  })

  it('resolves relative and absolute entry paths', () => {
    const doc = 'D:\\Project\\Refs.mfevirtual'
    expect(
      resolveVirtualFolderEntryPath(doc, { path: 'docs/specification.pdf', relative: true })
    ).toBe('D:\\Project\\docs\\specification.pdf')
    expect(
      resolveVirtualFolderEntryPath(doc, { path: 'F:\\AI\\Training', relative: false })
    ).toBe('F:\\AI\\Training')
    expect(
      resolveVirtualFolderEntryPath(doc, { path: '../sibling.txt', relative: true })
    ).toBe('D:\\sibling.txt')
  })

  it('uses normalized keys for duplicates', () => {
    const doc = 'D:\\Project\\Refs.mfevirtual'
    const a = virtualFolderEntryDuplicateKey(doc, {
      path: 'docs/A.pdf',
      relative: true
    })
    const b = virtualFolderEntryDuplicateKey(doc, {
      path: 'D:\\Project\\docs\\a.pdf',
      relative: false
    })
    expect(a).toBe(b)
  })

  it('entryDisplayName prefers label then basename', () => {
    expect(entryDisplayName({ path: 'a/b.txt', label: 'Note' })).toBe('Note')
    expect(entryDisplayName({ path: 'a/b.txt' }, 'b.txt')).toBe('b.txt')
    expect(entryDisplayName({ path: 'a/b.txt' })).toBe('b.txt')
  })
})

describe('virtualFolder JSON', () => {
  it('round-trips an empty document deterministically', () => {
    const doc = emptyVirtualFolderDocument('2026-08-29T00:00:00.000Z')
    doc.id = '11111111-1111-4111-8111-111111111111'
    const text = serializeVirtualFolderDocument(doc)
    expect(text).toContain(`"format": "${VIRTUAL_FOLDER_FORMAT}"`)
    expect(text.endsWith('\n')).toBe(true)
    const parsed = parseVirtualFolderJson(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.document.entries).toEqual([])
      expect(parsed.document.id).toBe(doc.id)
    }
  })

  it('rejects wrong format and unsupported version', () => {
    expect(parseVirtualFolderJson('{"format":"x","version":1,"id":"a","entries":[]}').ok).toBe(
      false
    )
    expect(
      parseVirtualFolderJson(
        JSON.stringify({
          format: VIRTUAL_FOLDER_FORMAT,
          version: 99,
          id: 'a',
          entries: []
        })
      ).ok
    ).toBe(false)
  })

  it('skips malformed entries without failing the document', () => {
    const raw = JSON.stringify({
      format: VIRTUAL_FOLDER_FORMAT,
      version: 1,
      id: 'doc',
      entries: [
        { id: 'ok', kind: 'file', path: 'a.txt', relative: true },
        { kind: 'file', path: 'no-id' },
        null
      ]
    })
    const parsed = parseVirtualFolderJson(raw)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.document.entries).toHaveLength(1)
      expect(parsed.skippedEntries).toBe(2)
    }
  })

  it('uses the locked extension constant', () => {
    expect(VIRTUAL_FOLDER_EXT).toBe('.mfevirtual')
  })

  it('guards nested visits against cycles', () => {
    const visited = new Set<string>()
    expect(beginVirtualFolderVisit('D:\\A.mfevirtual', visited)).toBeTruthy()
    expect(beginVirtualFolderVisit('D:\\A.mfevirtual', visited)).toBeNull()
    expect(beginVirtualFolderVisit('D:\\B.mfevirtual', visited)).toBeTruthy()
  })
})

describe('virtualFolder stem clash / projection paths', () => {
  it('derives stem and projected mount path', () => {
    expect(virtualFolderStemFromFileName('Work.mfevirtual')).toBe('Work')
    expect(virtualFolderProjectedMountPath('D:\\Collections\\Work.mfevirtual')).toBe(
      'D:\\Collections\\Work'
    )
  })

  it('blocks Virtual Folder create when a sibling folder shares the stem', () => {
    expect(virtualFolderDocumentStemBlocked('Work', ['Work', 'other.txt'])).toBe(true)
    expect(virtualFolderDocumentStemBlocked('Work', ['Work.mfevirtual'])).toBe(true)
    expect(virtualFolderDocumentStemBlocked('Work', ['other.txt'])).toBe(false)
  })

  it('blocks real folder create when a Virtual Folder shares the stem', () => {
    expect(realFolderStemBlockedByVirtualFolder('Work', ['Work.mfevirtual'])).toBe(true)
    expect(realFolderStemBlockedByVirtualFolder('Work', ['Work.txt'])).toBe(false)
  })

  it('suggests uniquified Virtual Folder and folder names', () => {
    expect(nextVirtualFolderFileName('Work', ['Work'])).toBe('Work (2).mfevirtual')
    expect(nextVirtualFolderFileName('Work', ['Work.mfevirtual'])).toBe('Work (2).mfevirtual')
    expect(nextRealFolderName('Work', ['Work.mfevirtual'])).toBe('Work (2)')
  })

  it('hides projected OS mount sibling beside a Virtual Folder document', () => {
    const listed = [
      { path: 'E:\\Movies\\TestVF.mfevirtual', kind: 'file' },
      { path: 'E:\\Movies\\TestVF', kind: 'dir' },
      { path: 'E:\\Movies\\Anime', kind: 'dir' },
      { path: 'E:\\Movies\\readme.txt', kind: 'file' }
    ]
    const filtered = filterOutProjectedMountPeers(listed)
    expect(filtered.map((e) => e.path)).toEqual([
      'E:\\Movies\\TestVF.mfevirtual',
      'E:\\Movies\\Anime',
      'E:\\Movies\\readme.txt'
    ])
  })

  it('hides legacy external nested Virtual Folder peers that are members of another sibling', () => {
    const parent = 'E:\\Movies\\Watch List.mfevirtual'
    const nested = 'E:\\Movies\\New Virtual Folder.mfevirtual'
    const other = 'E:\\Movies\\Series.mfevirtual'
    const docs: Record<string, { entries: import('@shared/virtualFolder').VirtualFolderEntry[] }> = {
      [parent]: {
        entries: [
          {
            id: '1',
            kind: 'virtualFolder',
            path: 'New Virtual Folder.mfevirtual',
            relative: true
          }
        ]
      },
      [nested]: { entries: [] },
      [other]: { entries: [] }
    }
    const listed = [{ path: parent }, { path: nested }, { path: other }, { path: 'E:\\Movies\\readme.txt' }]
    const filtered = filterOutNestedVirtualFolderPeers(listed, (p) => docs[p] ?? null)
    expect(filtered.map((e) => e.path)).toEqual([parent, other, 'E:\\Movies\\readme.txt'])
  })

  it('does not hide embedded groups (no sibling file)', () => {
    const parent = 'E:\\Movies\\Watch List.mfevirtual'
    const other = 'E:\\Movies\\Series.mfevirtual'
    const docs: Record<string, { entries: import('@shared/virtualFolder').VirtualFolderEntry[] }> = {
      [parent]: {
        entries: [{ id: '1', kind: 'virtualFolder', label: 'Nested', children: [] }]
      },
      [other]: { entries: [] }
    }
    const listed = [{ path: parent }, { path: other }]
    const filtered = filterOutNestedVirtualFolderPeers(listed, (p) => docs[p] ?? null)
    expect(filtered.map((e) => e.path)).toEqual([parent, other])
  })

  it('parses golden fixtures with embedded groups', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const empty = readFileSync(
      join(__dirname, 'fixtures/virtualFolder/empty.mfevirtual.json'),
      'utf8'
    )
    const mixed = readFileSync(
      join(__dirname, 'fixtures/virtualFolder/mixed-entries.mfevirtual.json'),
      'utf8'
    )
    const a = parseVirtualFolderJson(empty)
    const b = parseVirtualFolderJson(mixed)
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (b.ok) {
      expect(b.document.entries).toHaveLength(4)
      expect(isEmbeddedVirtualFolderGroup(b.document.entries[2]!)).toBe(true)
      expect(b.document.entries[2]!.children).toHaveLength(1)
      expect(isEmbeddedVirtualFolderGroup(b.document.entries[3]!)).toBe(false)
    }
  })

  it('encodes and finds embedded group rows', () => {
    const doc = 'E:\\Movies\\Test.mfevirtual'
    const row = virtualFolderGroupRowPath(doc, 'gid-1')
    expect(parseVirtualFolderGroupPath(row)).toEqual({ documentPath: doc, groupId: 'gid-1' })
    const entries = [
      {
        id: 'g1',
        kind: 'virtualFolder' as const,
        label: 'Inner',
        children: [{ id: 'f1', kind: 'file' as const, path: 'a.txt', relative: true }]
      }
    ]
    expect(findEntryInTree(entries, 'f1')?.kind).toBe('file')
    expect(getEntriesAtGroup(entries, 'g1')?.map((e) => e.id)).toEqual(['f1'])
    expect(getEntriesAtGroup(entries, null)?.map((e) => e.id)).toEqual(['g1'])
  })

  it('lists and parents nested embedded groups at arbitrary depth', () => {
    const entries = [
      {
        id: 'g1',
        kind: 'virtualFolder' as const,
        label: 'TT',
        children: [
          {
            id: 'g2',
            kind: 'virtualFolder' as const,
            label: 'UU',
            children: [
              {
                id: 'g3',
                kind: 'virtualFolder' as const,
                label: 'VV',
                children: [{ id: 'f1', kind: 'file' as const, path: 'a.txt', relative: true }]
              }
            ]
          }
        ]
      }
    ]
    expect(getEntriesAtGroup(entries, 'g1')?.map((e) => e.id)).toEqual(['g2'])
    expect(getEntriesAtGroup(entries, 'g2')?.map((e) => e.id)).toEqual(['g3'])
    expect(getEntriesAtGroup(entries, 'g3')?.map((e) => e.id)).toEqual(['f1'])
    expect(findParentGroupId(entries, 'g1')).toBe(null)
    expect(findParentGroupId(entries, 'g2')).toBe('g1')
    expect(findParentGroupId(entries, 'g3')).toBe('g2')
    expect(findParentGroupId(entries, 'f1')).toBe('g3')
    expect(findParentGroupId(entries, 'missing')).toBeUndefined()
    expect(virtualFolderTreeListPath('E:\\T.mfevirtual', 'g2')).toBe(
      virtualFolderGroupRowPath('E:\\T.mfevirtual', 'g2')
    )
    expect(virtualFolderTreeListPath('E:\\T.mfevirtual', null)).toBe('E:\\T.mfevirtual')
  })

  it('parses group paths with a doubled separator and resolves entry ids', () => {
    const doc = 'E:\\Movies\\TestVF.mfevirtual'
    const id = '5614dc97-226e-4ac5-863c-829b9ed4ed69'
    const messy = `mfe-vfgroup:${encodeURIComponent(doc)}||${id}`
    expect(parseVirtualFolderGroupPath(messy)).toEqual({ documentPath: doc, groupId: id })
    expect(virtualFolderEntryIdFromPath(messy)).toBe(id)
    expect(
      virtualFolderEntryIdFromPath(virtualFolderGroupRowPath(doc, id), {
        [virtualFolderGroupRowPath(doc, id).toLowerCase()]: id
      })
    ).toBe(id)
  })

  it('reparents entries with takeEntriesFromTree without dropping nested children', () => {
    const entries = [
      {
        id: 'g1',
        kind: 'virtualFolder' as const,
        label: 'TT',
        children: [
          {
            id: 'g2',
            kind: 'virtualFolder' as const,
            label: 'TSubF',
            children: [{ id: 'f1', kind: 'file' as const, path: 'a.txt', relative: true }]
          }
        ]
      },
      { id: 'g3', kind: 'virtualFolder' as const, label: 'Other', children: [] }
    ]
    expect(isVirtualFolderGroupAncestor(entries, 'g1', 'g2')).toBe(true)
    expect(isVirtualFolderGroupAncestor(entries, 'g2', 'g1')).toBe(false)
    const taken = takeEntriesFromTree(entries, ['g2'])
    expect(taken).toHaveLength(1)
    expect(taken[0]!.id).toBe('g2')
    expect(taken[0]!.children?.[0]?.id).toBe('f1')
    expect(entries.map((e) => e.id)).toEqual(['g1', 'g3'])
    expect(entries[0]!.children).toEqual([])
    mapEntriesAtGroup(entries, 'g3', (list) => [...list, ...taken])
    expect(getEntriesAtGroup(entries, 'g3')?.map((e) => e.id)).toEqual(['g2'])
  })

  it('rebases relative entry paths when extracting/absorbing across document dirs', () => {
    const fromDoc = 'E:\\Movies\\TestVF.mfevirtual'
    const toDoc = 'E:\\Other\\Extracted.mfevirtual'
    const entries = cloneVirtualFolderEntries([
      { id: 'f1', kind: 'file', path: 'clips/a.mp4', relative: true },
      { id: 'f2', kind: 'folder', path: 'F:\\Absolute\\Keep', relative: false },
      {
        id: 'g1',
        kind: 'virtualFolder',
        label: 'Nested',
        children: [{ id: 'f3', kind: 'file', path: 'nested/b.txt', relative: true }]
      }
    ])
    const rebased = rebaseVirtualFolderEntriesToDocument(fromDoc, toDoc, entries)
    expect(rebased[0]).toMatchObject({
      path: 'E:\\Movies\\clips\\a.mp4',
      relative: false
    })
    expect(rebased[1]).toMatchObject({
      path: 'F:\\Absolute\\Keep',
      relative: false
    })
    expect(rebased[2]!.children?.[0]).toMatchObject({
      path: 'E:\\Movies\\nested\\b.txt',
      relative: false
    })
    const back = rebaseVirtualFolderEntriesToDocument(toDoc, fromDoc, rebased)
    expect(back[0]).toMatchObject({ path: 'clips/a.mp4', relative: true })
    expect(back[2]!.children?.[0]).toMatchObject({ path: 'nested/b.txt', relative: true })
  })

  it('maps projected mount paths back to the sibling .mfevirtual', () => {
    expect(virtualFolderDocumentPathFromProjectedMount('D:\\Collections\\Work')).toBe(
      'D:\\Collections\\Work.mfevirtual'
    )
    expect(virtualFolderProjectedMountPath('D:\\Collections\\Work.mfevirtual')).toBe(
      'D:\\Collections\\Work'
    )
  })
})
