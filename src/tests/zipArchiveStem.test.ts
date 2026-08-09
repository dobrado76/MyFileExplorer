import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isZipPath, safeZipEntryPath, zipArchiveStem } from '../main/fs/zip'

describe('zipArchiveStem', () => {
  it('strips the last extension for a single file', () => {
    expect(zipArchiveStem([path.join('C:', 'a', 'photo.jpg')], false)).toBe('photo')
    expect(zipArchiveStem([path.join('C:', 'a', 'archive.tar.gz')], false)).toBe('archive.tar')
  })

  it('uses the folder name for a single directory', () => {
    expect(zipArchiveStem([path.join('C:', 'a', 'MyFolder')], true)).toBe('MyFolder')
  })

  it('uses the parent folder name for multi-select', () => {
    expect(
      zipArchiveStem(
        [path.join('C:', 'Downloads', 'a.txt'), path.join('C:', 'Downloads', 'b.txt')],
        false
      )
    ).toBe('Downloads')
  })
})

describe('isZipPath', () => {
  it('detects .zip case-insensitively', () => {
    expect(isZipPath('C:\\a\\pack.ZIP')).toBe(true)
    expect(isZipPath('C:\\a\\pack.txt')).toBe(false)
  })
})

describe('safeZipEntryPath', () => {
  const root = path.join('C:', 'extract', 'out')

  it('allows normal relative entries', () => {
    expect(safeZipEntryPath(root, 'readme.txt')).toBe(path.join(root, 'readme.txt'))
    expect(safeZipEntryPath(root, 'sub/a.txt')).toBe(path.join(root, 'sub', 'a.txt'))
  })

  it('blocks zip-slip paths', () => {
    expect(safeZipEntryPath(root, '../evil.txt')).toBeNull()
    expect(safeZipEntryPath(root, 'a/../../evil.txt')).toBeNull()
  })
})
