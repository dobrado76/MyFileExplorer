import { describe, expect, it } from 'vitest'
import {
  beginSlideshowListGen,
  cancelSlideshowList,
  isSlideshowListStale
} from '../main/slideshow/listImages'

describe('slideshow list cancel generation', () => {
  it('marks the in-flight gen stale after cancel', () => {
    const gen = beginSlideshowListGen()
    expect(isSlideshowListStale(gen)).toBe(false)
    cancelSlideshowList()
    expect(isSlideshowListStale(gen)).toBe(true)
  })

  it('a new list is not stale after a prior cancel', () => {
    const old = beginSlideshowListGen()
    cancelSlideshowList()
    const next = beginSlideshowListGen()
    expect(isSlideshowListStale(old)).toBe(true)
    expect(isSlideshowListStale(next)).toBe(false)
  })
})
