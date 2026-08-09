import { describe, expect, it } from 'vitest'
import { historyEntries } from '../renderer/lib/historyEntries'

describe('historyEntries', () => {
  it('puts current on top, then Back order (newest previous first)', () => {
    const list = historyEntries(['A', 'B', 'C'], 'D', [])
    expect(list.map((e) => e.path)).toEqual(['D', 'C', 'B', 'A'])
    expect(list[0]?.current).toBe(true)
    expect(list.slice(1).every((e) => !e.current)).toBe(true)
  })

  it('appends forward after the Back chain', () => {
    const list = historyEntries(['A', 'B'], 'C', ['D', 'E'])
    expect(list.map((e) => e.path)).toEqual(['C', 'B', 'A', 'D', 'E'])
  })

  it('dedupes case-insensitively, keeping first occurrence', () => {
    const list = historyEntries(['C:\\a', 'C:\\b'], 'C:\\A', ['C:\\b'])
    expect(list.map((e) => e.path)).toEqual(['C:\\A', 'C:\\b'])
  })
})
