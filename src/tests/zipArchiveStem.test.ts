import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { zipArchiveStem } from '../main/fs/zip'

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
