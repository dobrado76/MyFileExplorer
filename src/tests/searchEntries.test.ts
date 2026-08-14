import { describe, expect, it } from 'vitest'
import { pruneSearchResultItems } from '../renderer/lib/searchEntries'
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
