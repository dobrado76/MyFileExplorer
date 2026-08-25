import { describe, expect, it } from 'vitest'
import {
  isBasicNameQuery,
  parseEverythingQuery,
  rowMatchesStructured,
  searchDecodeMessage
} from '../main/search/everythingQuery'
import { buildSearchSql } from '../main/search/searchSql'
import {
  assertBasicSearchCase,
  BASIC_SEARCH_CASES,
  fixtureNames,
  fixtureNamesAfterWideSqlPull,
  SEARCH_FIXTURES,
  simulateBrokenOperatorParse
} from './searchFixtures'

describe('basic toolbar search — regression (dotted filenames)', () => {
  it.each(BASIC_SEARCH_CASES)('fixture corpus: $query', (spec) => {
    const names = fixtureNames(spec.query)
    assertBasicSearchCase(names, spec)
    expect(names.length).toBeLessThan(SEARCH_FIXTURES.length)
  })

  it.each(BASIC_SEARCH_CASES)('indexed wide-SQL pull + post-filter: $query', (spec) => {
    const names = fixtureNamesAfterWideSqlPull(spec.query)
    assertBasicSearchCase(names, spec)
  })

  it('REGRESSION: dotted basenames are name tokens, not ext:/size: operators', () => {
    for (const term of ['report.pdf', 'something.txt', 'annual-summary.pdf', 'photo.jpg']) {
      const q = parseEverythingQuery(term)
      expect(q.advanced).toBe(false)
      expect(q.exts).toEqual([])
      expect(q.size).toBeNull()
      expect(q.textGroups).toEqual([[{ kind: 'substr', value: term, wholeWord: false }]])
    }
  })

  it('REGRESSION: broken empty textGroups must not match unrelated decoys', () => {
    for (const term of ['something.txt', 'report.pdf', 'readme.txt']) {
      const q = simulateBrokenOperatorParse(term)
      const hits = SEARCH_FIXTURES.filter((row) => rowMatchesStructured(row, q))
      expect(hits.map((r) => r.name)).toEqual([])
    }
  })

  it('REGRESSION: matchPath + regex settings must not return folders or jpgs', () => {
    for (const spec of BASIC_SEARCH_CASES) {
      const names = fixtureNames(spec.query, { matchPath: true, regex: true })
      assertBasicSearchCase(names, spec)
    }
  })

  it('REGRESSION: !!Thumbs.db is a file name, not a NOT operator', () => {
    expect(isBasicNameQuery('!!Thumbs.db')).toBe(true)
    expect(parseEverythingQuery('!!Thumbs.db').textGroups).toEqual([
      [{ kind: 'substr', value: '!!Thumbs.db', wholeWord: false }]
    ])
    expect(fixtureNames('!!Thumbs.db')).toEqual(['!!Thumbs.db'])
    expect(searchDecodeMessage('!ext:jpg', parseEverythingQuery('!ext:jpg'))).toBeTruthy()
    expect(searchDecodeMessage('!!Thumbs.db', parseEverythingQuery('!!Thumbs.db'))).toBeNull()
  })

  it('REGRESSION: !Thumbnails alone is a literal name (folders and files)', () => {
    expect(isBasicNameQuery('!Thumbnails')).toBe(true)
    expect(parseEverythingQuery('!Thumbnails').textGroups).toEqual([
      [{ kind: 'substr', value: '!Thumbnails', wholeWord: false }]
    ])
    expect(searchDecodeMessage('!Thumbnails', parseEverythingQuery('!Thumbnails'))).toBeNull()
  })

  it('REGRESSION: searching readme.txt must not return folders or jpgs', () => {
    const names = fixtureNames('readme.txt')
    expect(names).toEqual(['readme.txt'])
    expect(names).not.toContain('photo.jpg')
    expect(names).not.toContain('Archive')
    expect(names).not.toContain('Vacation')
    expect(names).not.toContain('mirror.jpg')
  })
})

describe('basic toolbar search — indexed SQL pre-filter', () => {
  it.each(BASIC_SEARCH_CASES)('buildSql adds name LIKE for: $query', (spec) => {
    const q = parseEverythingQuery(spec.query)
    const { sql, params } = buildSearchSql(q, 'C:\\Data')
    expect(sql).toContain('name LIKE')
    const token = spec.query.split(/\s+/)[0]!
    expect(params.some((p) => typeof p === 'string' && p.includes(token.replace(/^\*|\*$/g, '')))).toBe(
      true
    )
  })

  it('simulated over-broad SQL result is narrowed by post-filter', () => {
    // If SQL were broken (WHERE 1=1 only), post-filter must still reject decoys.
    for (const spec of BASIC_SEARCH_CASES) {
      const names = fixtureNamesAfterWideSqlPull(spec.query)
      assertBasicSearchCase(names, spec)
    }
  })
})
