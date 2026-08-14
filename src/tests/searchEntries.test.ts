import { describe, expect, it } from 'vitest'
import { mergeDismissedPaths, pruneSearchResultItems } from '../renderer/lib/searchEntries'
import type { SearchResultItem } from '../shared/schemas/search'

function hit(path: string): SearchResultItem {
  const name = path.replace(/^.*[\\/]/, '')
  return { path, name, mtimeMs: 0, size: 0, isDir: false }
}

describe('pruneSearchResultItems', () => {
  it('removes deleted hits and children of a deleted folder', () => {
    const items = [
      hit('C:\\pics\\cat.jpg'),
      hit('C:\\pics\\dog.jpg'),
      hit('C:\\pics\\album\\a.jpg'),
      hit('D:\\keep.png')
    ]
    const next = pruneSearchResultItems(items, ['C:\\pics\\cat.jpg', 'C:\\pics\\album'])
    expect(next.map((r) => r.path)).toEqual(['C:\\pics\\dog.jpg', 'D:\\keep.png'])
  })

  it('is a no-op when nothing was removed', () => {
    const items = [hit('C:\\a.txt')]
    expect(pruneSearchResultItems(items, [])).toBe(items)
    expect(pruneSearchResultItems(items, ['C:\\other.txt'])).toEqual(items)
  })
})

describe('mergeDismissedPaths', () => {
  it('records new paths and skips ones already covered by a parent', () => {
    const first = mergeDismissedPaths([], ['C:\\pics\\cat.jpg', 'C:\\pics\\album'])
    expect(first).toEqual(['C:\\pics\\cat.jpg', 'C:\\pics\\album'])
    const again = mergeDismissedPaths(first, ['C:\\pics\\cat.jpg', 'C:\\pics\\album\\a.jpg'])
    expect(again).toBe(first)
  })

  it('keeps later progress from resurrecting a dismissed hit', () => {
    const dismissed = mergeDismissedPaths([], ['C:\\pics\\cat.jpg'])
    const streamed = [hit('C:\\pics\\cat.jpg'), hit('C:\\pics\\dog.jpg')]
    expect(pruneSearchResultItems(streamed, dismissed).map((r) => r.path)).toEqual([
      'C:\\pics\\dog.jpg'
    ])
  })
})
