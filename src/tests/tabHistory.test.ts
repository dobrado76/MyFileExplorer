import { describe, expect, it } from 'vitest'
import {
  coerceHistoryList,
  folderHistory,
  historyEntryKey,
  historyEntryLabel,
  persistHistoryEntry,
  rewriteHistoryEntry,
  searchHistory,
  sameHistoryEntry
} from '../shared/tabHistory'

describe('tabHistory', () => {
  it('coerces legacy path strings and tagged objects', () => {
    expect(coerceHistoryList(['C:\\Data', { kind: 'folder', path: 'D:\\' }])).toEqual([
      folderHistory('C:\\Data'),
      folderHistory('D:\\')
    ])
    expect(
      coerceHistoryList([{ kind: 'search', query: 'a.txt', scopePath: 'C:\\', indexedOnly: true }])
    ).toEqual([searchHistory('a.txt', 'C:\\', true)])
  })

  it('treats a search as distinct from its scope folder', () => {
    const folder = folderHistory('C:\\Data')
    const search = searchHistory('!!Thumbs.db', 'C:\\Data', false)
    expect(sameHistoryEntry(folder, search)).toBe(false)
    expect(historyEntryKey(search)).toContain('search:')
    expect(historyEntryLabel(search)).toBe('Search: !!Thumbs.db')
  })

  it('rewrites folder path and search scope on rename', () => {
    const rewrite = (p: string): string => (p === 'C:\\Old' ? 'C:\\New' : p)
    expect(rewriteHistoryEntry(folderHistory('C:\\Old'), rewrite)).toEqual(folderHistory('C:\\New'))
    expect(rewriteHistoryEntry(searchHistory('q', 'C:\\Old', false), rewrite)).toEqual(
      searchHistory('q', 'C:\\New', false)
    )
  })

  it('stores folder scroll on history entries and keeps it through persist/coerce', () => {
    const e = folderHistory('C:\\Data', 1400)
    expect(e).toEqual({ kind: 'folder', path: 'C:\\Data', scrollOffset: 1400 })
    expect(persistHistoryEntry(e)).toEqual(e)
    expect(coerceHistoryList([e])).toEqual([e])
    expect(folderHistory('C:\\Data', 0)).toEqual({ kind: 'folder', path: 'C:\\Data' })
  })

  it('stores and rewrites the row to focus when returning to a folder', () => {
    const e = folderHistory('C:\\Data', 1400, 'C:\\Data\\Photos')
    expect(persistHistoryEntry(e)).toEqual(e)
    expect(coerceHistoryList([e])).toEqual([e])
    expect(rewriteHistoryEntry(e, (p) => p.replace('C:\\Data', 'D:\\Archive'))).toEqual(
      folderHistory('D:\\Archive', 1400, 'D:\\Archive\\Photos')
    )
  })

  it('file rename inside a focused child does not clear parent scroll/focus', () => {
    const parent = '\\\\nas\\share\\Series'
    const child = '\\\\nas\\share\\Series\\Album'
    const e = folderHistory(parent, 2400, child)
    const from = `${child}\\a.mp4`
    const to = `${child}\\b.mp4`
    const rewrite = (p: string): string => {
      if (p.toLowerCase() === from.toLowerCase()) return to
      if (p.toLowerCase().startsWith(from.toLowerCase() + '\\')) {
        return to + p.slice(from.length)
      }
      return p
    }
    expect(rewriteHistoryEntry(e, rewrite)).toEqual(e)
  })

  it('persistHistoryEntry is a plain clone', () => {
    const e = searchHistory('q', 'C:\\', false)
    expect(persistHistoryEntry(e)).toEqual(e)
    expect(persistHistoryEntry(e)).not.toBe(e)
  })
})
