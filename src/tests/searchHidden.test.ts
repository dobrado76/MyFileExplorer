import { describe, expect, it } from 'vitest'
import {
  attrsAreHidden,
  isHiddenSearchHit,
  pathHasVidThumbCacheDir,
  pathIsUnderHiddenDir
} from '../shared/searchHidden'

describe('search hidden helpers', () => {
  it('detects FILE_ATTRIBUTE_HIDDEN', () => {
    expect(attrsAreHidden(0x2)).toBe(true)
    expect(attrsAreHidden(0x22)).toBe(true)
    expect(attrsAreHidden(0x20)).toBe(false)
    expect(attrsAreHidden(null)).toBe(false)
  })

  it('treats !VIDTHUMB_CACHE as a hidden cache folder', () => {
    expect(pathHasVidThumbCacheDir('E:\\Movies\\Show\\!VIDTHUMB_CACHE')).toBe(true)
    expect(pathHasVidThumbCacheDir('E:\\Movies\\Show\\!VIDTHUMB_CACHE\\clip.mp4.thumb_1.jpg')).toBe(
      true
    )
    expect(pathHasVidThumbCacheDir('E:\\Movies\\Show\\clip.mp4')).toBe(false)
  })

  it('hides descendants of indexed hidden directories', () => {
    const hidden = new Set(['e:\\movies\\show\\!vidthumb_cache'])
    expect(
      pathIsUnderHiddenDir('E:\\Movies\\Show\\!VIDTHUMB_CACHE\\a.jpg', hidden)
    ).toBe(true)
    expect(pathIsUnderHiddenDir('E:\\Movies\\Show\\clip.mkv', hidden)).toBe(false)
  })

  it('combines attr, cache folder, and ancestor checks', () => {
    expect(isHiddenSearchHit({ path: 'E:\\Movies\\a.srt', attrs: 0x2 })).toBe(true)
    expect(
      isHiddenSearchHit({ path: 'E:\\Movies\\Show\\!VIDTHUMB_CACHE\\x.jpg', attrs: 0 })
    ).toBe(true)
    expect(isHiddenSearchHit({ path: 'E:\\Movies\\Show\\clip.mkv', attrs: 0 })).toBe(false)
  })
})
