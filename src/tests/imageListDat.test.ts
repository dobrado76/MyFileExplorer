import { describe, expect, it } from 'vitest'
import {
  mergeImageList,
  parseImageListDat,
  serializeImageListDat
} from '../shared/slideshow/imageListDat'

describe('imageListDat', () => {
  it('parses paths and skips comments/blanks', () => {
    expect(
      parseImageListDat(`# header\nC:\\\\a\\\\1.jpg\n\nC:\\\\a\\\\2.png\nC:\\\\a\\\\1.jpg\n`)
    ).toEqual(['C:\\\\a\\\\1.jpg', 'C:\\\\a\\\\2.png'])
  })

  it('merges without dupes', () => {
    expect(mergeImageList(['C:\\a\\1.jpg'], ['C:\\a\\1.jpg', 'C:\\a\\2.jpg'])).toEqual([
      'C:\\a\\1.jpg',
      'C:\\a\\2.jpg'
    ])
  })

  it('round-trips', () => {
    const paths = ['C:\\x\\a.jpg', 'C:\\x\\b.png']
    expect(parseImageListDat(serializeImageListDat(paths))).toEqual(paths)
  })
})
