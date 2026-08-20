import { describe, expect, it } from 'vitest'
import type { SlideshowPlaylistCursor } from '../shared/slideshow/playlist'
import {
  slideshowFirstIndex,
  slideshowLastIndex,
  slideshowLength,
  slideshowNextIndex
} from '../shared/slideshow/playlist'

function folderList(paths: string[], skipped: number[] = []): SlideshowPlaylistCursor {
  return { paths, skipped: new Set(skipped) }
}

describe('slideshow playlist skip set', () => {
  it('length subtracts skipped indexes without copying paths', () => {
    const paths = Array.from({ length: 10_000 }, (_, i) => `p${i}`)
    const a = folderList(paths)
    expect(slideshowLength(a)).toBe(10_000)
    a.skipped!.add(3)
    a.skipped!.add(9)
    expect(slideshowLength(a)).toBe(9_998)
    expect(a.paths).toBe(paths)
  })

  it('next index skips tombstones in O(distance), not O(list)', () => {
    const a = folderList(['a', 'b', 'c', 'd', 'e'], [1, 2])
    expect(slideshowNextIndex(a, 0, 1, false)).toBe(3)
    expect(slideshowNextIndex(a, 3, -1, false)).toBe(0)
  })

  it('wraps to the first live item when loop is on', () => {
    const a = folderList(['a', 'b', 'c'], [2])
    expect(slideshowNextIndex(a, 1, 1, true)).toBe(0)
    expect(slideshowNextIndex(a, 0, -1, true)).toBe(1)
  })

  it('returns null when every index is skipped', () => {
    const a = folderList(['a', 'b'], [0, 1])
    expect(slideshowLength(a)).toBe(0)
    expect(slideshowNextIndex(a, 0, 1, true)).toBeNull()
    expect(slideshowFirstIndex(a)).toBeNull()
    expect(slideshowLastIndex(a)).toBeNull()
  })

  it('first / last ignore skipped ends', () => {
    const a = folderList(['a', 'b', 'c', 'd'], [0, 3])
    expect(slideshowFirstIndex(a)).toBe(1)
    expect(slideshowLastIndex(a)).toBe(2)
  })
})
