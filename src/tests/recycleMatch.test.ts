import { describe, expect, it } from 'vitest'
import { matchRecycleOriginal } from '../main/fs/recycleMatch'

describe('matchRecycleOriginal', () => {
  const folder = 'C:\\libs\\MyPack'
  const wantedFolder = new Set([folder.toLowerCase()])

  it('matches the folder bin item (DeletedFrom=parent, Name=folder)', () => {
    expect(matchRecycleOriginal('C:\\libs', 'MyPack', wantedFolder)).toBe(folder)
  })

  it('does not match files previously deleted from inside the folder', () => {
    // Undoing folder-delete must not restore earlier file-deletes that still sit in the bin.
    expect(matchRecycleOriginal(folder, 'a.png', wantedFolder)).toBeNull()
    expect(matchRecycleOriginal(folder, 'notes.txt', wantedFolder)).toBeNull()
  })

  it('matches a file when that file path is explicitly wanted', () => {
    const file = 'C:\\libs\\MyPack\\a.png'
    const wanted = new Set([file.toLowerCase()])
    expect(matchRecycleOriginal(folder, 'a.png', wanted)).toBe(file)
  })

  it('accepts DeletedFrom as full path when basename matches Name', () => {
    expect(matchRecycleOriginal(folder, 'MyPack', wantedFolder)).toBe(folder)
  })

  it('rejects DeletedFrom=full path when Name is a different child', () => {
    expect(matchRecycleOriginal(folder, 'a.png', wantedFolder)).toBeNull()
  })
})
