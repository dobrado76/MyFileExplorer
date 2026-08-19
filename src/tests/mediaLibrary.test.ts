import { describe, expect, it } from 'vitest'
import { listingFoldersFirst } from '../renderer/lib/mediaLibrary'

describe('listingFoldersFirst', () => {
  const mediaContainer = {
    foldersFirst: true,
    mediaEnabled: true,
    mixFilesAndFolders: true,
    isContainer: true,
    listingPath: 'C:\\Media',
    containerPath: 'C:\\Media'
  }

  it('keeps folders before files for Name sorting', () => {
    expect(listingFoldersFirst({ ...mediaContainer, sortKey: 'name' })).toBe(true)
  })

  it('still allows mixed media-library ordering for other sorts', () => {
    expect(listingFoldersFirst({ ...mediaContainer, sortKey: 'mtime' })).toBe(false)
  })
})
