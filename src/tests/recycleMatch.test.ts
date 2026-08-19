import { describe, expect, it } from 'vitest'
import { matchRecycleOriginal, pickRecycleBinTargets } from '../main/fs/recycleMatch'

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

describe('pickRecycleBinTargets', () => {
  const older = {
    recyclePath: 'C:\\$Recycle.Bin\\S-1\\$R1',
    originalPath: 'D:\\repo\\file.ext',
    dateDeletedMs: 100
  }
  const newer = {
    recyclePath: 'C:\\$Recycle.Bin\\S-1\\$R2',
    originalPath: 'D:\\repo\\file.ext',
    dateDeletedMs: 200
  }
  const other = {
    recyclePath: 'C:\\$Recycle.Bin\\S-1\\$R3',
    originalPath: 'D:\\repo\\other.txt',
    dateDeletedMs: 150
  }

  it('picks one row by recyclePath when the same original exists twice', () => {
    const got = pickRecycleBinTargets([older, newer, other], [older.recyclePath])
    expect(got).toEqual([older])
  })

  it('undo by original path restores only the newest delete', () => {
    const got = pickRecycleBinTargets([older, newer, other], ['D:\\repo\\file.ext'])
    expect(got).toEqual([newer])
  })

  it('can restore both copies when both recyclePaths are selected', () => {
    const got = pickRecycleBinTargets([older, newer], [older.recyclePath, newer.recyclePath])
    expect(got).toHaveLength(2)
  })
})
