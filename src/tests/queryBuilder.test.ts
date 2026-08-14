import { describe, it, expect } from 'vitest'
import {
  buildFtsMatchExpression,
  escapeLike,
  buildLikeContains,
  buildNameLikeParams,
  buildPathPrefixLike,
  globToLike,
  globToRegExp,
  isIncompleteSearchQuery,
  nameMatches,
  queryTokens,
  tokenHasWildcards
} from '../main/search/queryBuilder'

describe('buildFtsMatchExpression', () => {
  it('adds prefix wildcard per token', () => {
    expect(buildFtsMatchExpression('cat')).toBe('"cat"*')
    expect(buildFtsMatchExpression('cat picture')).toBe('"cat"* "picture"*')
  })
  it('quotes FTS operators away', () => {
    expect(buildFtsMatchExpression('NOT AND')).toBe('"NOT"* "AND"*')
  })
  it('escapes double quotes', () => {
    expect(buildFtsMatchExpression('say"hi')).toBe('"say""hi"*')
  })
  it('returns null for whitespace-only input', () => {
    expect(buildFtsMatchExpression('   ')).toBeNull()
  })
})

describe('LIKE building', () => {
  it('escapes wildcards', () => {
    expect(escapeLike('100%_done\\x')).toBe('100\\%\\_done\\\\x')
  })
  it('builds contains patterns', () => {
    expect(buildLikeContains('cat')).toBe('%cat%')
    expect(buildLikeContains(' 5% off ')).toBe('%5\\% off%')
  })
  it('builds substring LIKE for plain tokens and glob LIKE for * / ?', () => {
    expect(buildNameLikeParams('trip 2024')).toEqual(['%trip%', '%2024%'])
    expect(buildNameLikeParams('*.jpg')).toEqual(['%.jpg'])
    expect(buildNameLikeParams('img_????.png')).toEqual(['img\\_____.png'])
    expect(buildNameLikeParams('.jpg')).toEqual(['%.jpg%'])
  })
  it('builds path prefix filters that include children only', () => {
    expect(buildPathPrefixLike('C:\\data')).toBe('C:\\\\data\\\\%')
    expect(buildPathPrefixLike('C:\\data\\')).toBe('C:\\\\data\\\\%')
  })
})

describe('glob helpers', () => {
  it('detects wildcards', () => {
    expect(tokenHasWildcards('*.jpg')).toBe(true)
    expect(tokenHasWildcards('photo')).toBe(false)
  })
  it('maps glob to LIKE', () => {
    expect(globToLike('*.jpg')).toBe('%.jpg')
    expect(globToLike('a?b')).toBe('a_b')
    expect(globToLike('100%')).toBe('100\\%')
  })
  it('maps glob to RegExp', () => {
    expect(globToRegExp('*.jpg').test('photo.jpg')).toBe(true)
    expect(globToRegExp('*.jpg').test('photo.jpeg')).toBe(false)
    expect(globToRegExp('img_??.png').test('img_01.png')).toBe(true)
  })
})

describe('nameMatches', () => {
  it('matches case-insensitive substrings', () => {
    expect(nameMatches('MyPhoto.PNG', 'photo')).toBe(true)
  })
  it('requires all tokens', () => {
    expect(nameMatches('summer-trip-2024.jpg', 'trip 2024')).toBe(true)
    expect(nameMatches('summer-trip-2024.jpg', 'trip 2025')).toBe(false)
  })
  it('supports *.ext and bare .ext as substring (so .o includes .obj)', () => {
    expect(nameMatches('vacation.JPG', '*.jpg')).toBe(true)
    expect(nameMatches('vacation.JPG', '.jpg')).toBe(true)
    expect(nameMatches('vacation.jpeg', '.jpg')).toBe(false)
    expect(nameMatches('wine.obj', '.o')).toBe(true)
    expect(nameMatches('wine.obj', '.ob')).toBe(true)
    expect(nameMatches('wine.obj', '.obj')).toBe(true)
    expect(nameMatches('wine.fbx', '.obj')).toBe(false)
    expect(nameMatches('notjpg', '*.jpg')).toBe(false)
  })
  it('rejects empty queries', () => {
    expect(nameMatches('anything', '  ')).toBe(false)
  })
})

describe('queryTokens', () => {
  it('splits on whitespace and expands bare extensions', () => {
    expect(queryTokens('  a  b ')).toEqual(['a', 'b'])
    expect(queryTokens('.jpg')).toEqual(['.jpg'])
    expect(queryTokens('.')).toEqual(['.'])
  })
})

describe('isIncompleteSearchQuery', () => {
  it('treats a lone dot as not yet an extension filter', () => {
    expect(isIncompleteSearchQuery('.')).toBe(true)
    expect(isIncompleteSearchQuery(' . ')).toBe(true)
    expect(isIncompleteSearchQuery('.o')).toBe(false)
    expect(isIncompleteSearchQuery('.obj')).toBe(false)
    expect(isIncompleteSearchQuery('obj')).toBe(false)
  })
})

describe('nameMatches lone dot', () => {
  it('matches any dotted name — why we refuse to walk on "."', () => {
    expect(nameMatches('blocks.fbx', '.')).toBe(true)
    expect(nameMatches('.gitignore', '.')).toBe(true)
    expect(nameMatches('README', '.')).toBe(false)
  })
})
