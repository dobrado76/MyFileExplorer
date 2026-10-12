import { describe, expect, it } from 'vitest'
import { pathKey } from '../shared/paths'
import { createRemovalMatcher, removalDirectoryKeys } from '../shared/removalMatch'

describe('createRemovalMatcher', () => {
  it('matches exact paths in O(1) when no directories are removed', () => {
    const removed = Array.from({ length: 1000 }, (_, i) => `C:\\Photos\\f${i}.jpg`)
    const m = createRemovalMatcher(removed, { directoryKeys: new Set() })
    expect(m.matches('C:\\Photos\\f0.jpg')).toBe(true)
    expect(m.matches('C:\\Photos\\f999.jpg')).toBe(true)
    expect(m.matches('C:\\Photos\\other.jpg')).toBe(false)
    expect(m.matches('C:\\Photos\\f0.jpg\\nope')).toBe(false)
  })

  it('matches descendants of removed directories', () => {
    const m = createRemovalMatcher(['C:\\Photos\\Album', 'C:\\a.txt'], {
      directoryKeys: new Set([pathKey('C:\\Photos\\Album')])
    })
    expect(m.matches('C:\\Photos\\Album')).toBe(true)
    expect(m.matches('C:\\Photos\\Album\\x.jpg')).toBe(true)
    expect(m.matches('C:\\a.txt')).toBe(true)
    expect(m.matches('C:\\Photos\\Other\\x.jpg')).toBe(false)
  })
})

describe('removalDirectoryKeys', () => {
  it('only marks known dirs (and unknowns) as directory roots', () => {
    const known = new Map<string, 'dir' | 'file'>([
      [pathKey('C:\\a'), 'dir'],
      [pathKey('C:\\b.txt'), 'file']
    ])
    const dirs = removalDirectoryKeys(['C:\\a', 'C:\\b.txt', 'C:\\missing'], known)
    expect(dirs.has(pathKey('C:\\a'))).toBe(true)
    expect(dirs.has(pathKey('C:\\b.txt'))).toBe(false)
    expect(dirs.has(pathKey('C:\\missing'))).toBe(true)
  })
})
