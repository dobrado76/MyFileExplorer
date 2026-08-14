import { describe, expect, it } from 'vitest'
import {
  isSearchNarrowing,
  nameMatches,
  narrowSearchItems,
  queryTokens
} from '../shared/searchQuery'
import type { SearchResultItem } from '../shared/schemas/search'

function hit(name: string): SearchResultItem {
  return { path: `C:\\${name}`, name, size: 1, mtimeMs: 1, isDir: false }
}

describe('isSearchNarrowing', () => {
  it('treats extra characters as a subset query', () => {
    expect(isSearchNarrowing('.o', '.ob')).toBe(true)
    expect(isSearchNarrowing('.ob', '.obj')).toBe(true)
    expect(isSearchNarrowing('.o', '.obj')).toBe(true)
    expect(isSearchNarrowing('.', '.o')).toBe(false)
    expect(isSearchNarrowing('.obj', '.ob')).toBe(false)
    expect(isSearchNarrowing('foo', 'bar')).toBe(false)
    expect(isSearchNarrowing('ext:o', 'ext:ob')).toBe(false)
  })
})

describe('narrowSearchItems', () => {
  it('filters walk hits as the extension is typed', () => {
    const items = [hit('wine.obj'), hit('note.ogg'), hit('mesh.fbx')]
    expect(narrowSearchItems(items, '.o', '.ob').map((r) => r.name)).toEqual(['wine.obj'])
    expect(narrowSearchItems(items, '.o', '.obj').map((r) => r.name)).toEqual(['wine.obj'])
  })
})

describe('queryTokens', () => {
  it('does not rewrite .obj to *.obj (endswith would drop longer extensions)', () => {
    expect(queryTokens('.obj')).toEqual(['.obj'])
    expect(nameMatches('hero.obj', '.o')).toBe(true)
  })
})
