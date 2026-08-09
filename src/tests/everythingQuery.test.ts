import { describe, expect, it } from 'vitest'
import {
  parseEverythingQuery,
  rowMatchesStructured,
  matchTextGroups
} from '../main/search/everythingQuery'

describe('parseEverythingQuery', () => {
  it('parses AND tokens and OR groups', () => {
    const q = parseEverythingQuery('foo bar')
    expect(q.textGroups).toHaveLength(2)
    const or = parseEverythingQuery('a|b c')
    expect(or.textGroups[0]?.length).toBe(2)
    expect(or.textGroups).toHaveLength(2)
  })

  it('parses size and ext and macros', () => {
    const q = parseEverythingQuery('size:>1mb ext:jpg;png pic:')
    expect(q.size?.op).toBe('gt')
    expect(q.exts).toContain('jpg')
    expect(q.exts).toContain('png')
    expect(q.exts).toContain('webp')
    expect(q.advanced).toBe(true)
  })

  it('parses path drive token and NOT', () => {
    const q = parseEverythingQuery('d:\\AI !tmp')
    expect(q.pathPrefixes.some((p) => p.toLowerCase().startsWith('d:\\ai'))).toBe(true)
    expect(q.notText.length).toBe(1)
  })

  it('parses content:', () => {
    const q = parseEverythingQuery('content:hello file:')
    expect(q.content).toBe('hello')
    expect(q.fileOnly).toBe(true)
  })
})

describe('rowMatchesStructured', () => {
  it('matches size and ext', () => {
    const q = parseEverythingQuery('size:>100 ext:txt')
    expect(
      rowMatchesStructured(
        { path: 'C:\\a\\b.txt', name: 'b.txt', size: 200, mtimeMs: 1, isDir: false },
        q
      )
    ).toBe(true)
    expect(
      rowMatchesStructured(
        { path: 'C:\\a\\b.txt', name: 'b.txt', size: 50, mtimeMs: 1, isDir: false },
        q
      )
    ).toBe(false)
  })

  it('supports OR text groups', () => {
    const q = parseEverythingQuery('cat|dog')
    expect(matchTextGroups(q.textGroups, 'mydog.jpg', 'C:\\mydog.jpg', false, false)).toBe(true)
    expect(matchTextGroups(q.textGroups, 'bird.jpg', 'C:\\bird.jpg', false, false)).toBe(false)
  })
})
