import { describe, expect, it } from 'vitest'
import {
  VIRTUAL_FOLDER_EXT,
  VIRTUAL_FOLDER_FORMAT,
  chooseVirtualFolderStoredPath,
  emptyVirtualFolderDocument,
  entryDisplayName,
  isVirtualFolderDocumentPath,
  isVirtualFolderExt,
  virtualFolderDisplayName,
  virtualFolderDocumentDir,
  virtualFolderEntryDuplicateKey,
  resolveVirtualFolderEntryPath,
  serializeVirtualFolderDocument,
  beginVirtualFolderVisit
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
