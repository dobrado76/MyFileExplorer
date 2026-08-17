import { describe, expect, it } from 'vitest'
import {
  getThumbMemory,
  invalidateThumbMemory,
  invalidateThumbMemoryMany,
  setThumbMemory,
  thumbMemoryKey,
  thumbPathKey
} from '../renderer/lib/thumbMemory'

describe('thumbPathKey', () => {
  it('treats slash styles as the same file', () => {
    expect(thumbPathKey('F:/Movies/Heat (1995)')).toBe(thumbPathKey('F:\\Movies\\Heat (1995)'))
  })
})

describe('invalidateThumbMemory', () => {
  it('drops only keys for that path', () => {
    const a = thumbMemoryKey('F:\\Movies\\A', 1, 64, 0, 0)
    const b = thumbMemoryKey('F:\\Movies\\B', 1, 64, 0, 0)
    setThumbMemory(a, { url: 'media://a' })
    setThumbMemory(b, { url: 'media://b' })
    invalidateThumbMemory('F:/Movies/A')
    expect(getThumbMemory(a)).toBeUndefined()
    expect(getThumbMemory(b)?.url).toBe('media://b')
    invalidateThumbMemoryMany(['F:\\Movies\\B'])
    expect(getThumbMemory(b)).toBeUndefined()
  })
})
