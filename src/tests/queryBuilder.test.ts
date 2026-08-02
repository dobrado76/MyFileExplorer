import { describe, it, expect } from 'vitest'
import {
  buildFtsMatchExpression,
  escapeLike,
  buildLikeContains,
  buildPathPrefixLike,
  nameMatches
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
  it('builds path prefix filters that include children only', () => {
    expect(buildPathPrefixLike('C:\\data')).toBe('C:\\\\data\\\\%')
    expect(buildPathPrefixLike('C:\\data\\')).toBe('C:\\\\data\\\\%')
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
  it('rejects empty queries', () => {
    expect(nameMatches('anything', '  ')).toBe(false)
  })
})
