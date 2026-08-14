import { describe, expect, it } from 'vitest'
import { folderHistory, searchHistory } from '../shared/tabHistory'
import { historyEntries } from '../renderer/lib/historyEntries'

describe('historyEntries', () => {
  it('puts current on top, then Back order (newest previous first)', () => {
    const list = historyEntries(
      [folderHistory('A'), folderHistory('B'), folderHistory('C')],
      folderHistory('D'),
      []
    )
    expect(list.map((e) => e.path)).toEqual(['D', 'C', 'B', 'A'])
    expect(list[0]?.current).toBe(true)
    expect(list.slice(1).every((e) => !e.current)).toBe(true)
  })

  it('appends forward after the Back chain', () => {
    const list = historyEntries(
      [folderHistory('A'), folderHistory('B')],
      folderHistory('C'),
      [folderHistory('D'), folderHistory('E')]
    )
    expect(list.map((e) => e.path)).toEqual(['C', 'B', 'A', 'D', 'E'])
  })

  it('dedupes case-insensitively, keeping first occurrence', () => {
    const list = historyEntries(
      [folderHistory('C:\\a'), folderHistory('C:\\b')],
      folderHistory('C:\\A'),
      [folderHistory('C:\\b')]
    )
    expect(list.map((e) => e.path)).toEqual(['C:\\A', 'C:\\b'])
  })

  it('keeps a search location distinct from its scope folder', () => {
    const list = historyEntries(
      [folderHistory('C:\\Data')],
      searchHistory('!!Thumbs.db', 'C:\\Data', false),
      []
    )
    expect(list).toHaveLength(2)
    expect(list[0]?.label).toBe('Search: !!Thumbs.db')
    expect(list[0]?.current).toBe(true)
    expect(list[1]?.path).toBe('C:\\Data')
  })
})
