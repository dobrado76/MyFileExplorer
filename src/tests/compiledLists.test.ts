import { describe, expect, it } from 'vitest'
import {
  lastListHasPositiveCounts,
  parseDatImageLines,
  parseLastListText,
  parseTxtFolderLines,
  sanitizeCompiledName,
  serializeLastList
} from '../shared/slideshow/compiledLists'

describe('compiledLists helpers', () => {
  it('sanitizes names', () => {
    expect(sanitizeCompiledName('A/B:C')).toBe('A_B_C')
    expect(sanitizeCompiledName('  ')).toBe('List')
  })

  it('parses and serializes last list lines', () => {
    const text = `C:\\a\\x.dat|=>2\n\n# comment\nD:\\b\\y.txt|=>0\nE:\\c\\z.dat|=>1\n`
    const lines = parseLastListText(text)
    expect(lines).toEqual([
      { datPath: 'C:\\a\\x.dat', count: 2 },
      { datPath: 'D:\\b\\y.txt', count: 0 },
      { datPath: 'E:\\c\\z.dat', count: 1 }
    ])
    expect(serializeLastList(lines)).toBe('C:\\a\\x.dat|=>2\nE:\\c\\z.dat|=>1')
    expect(lastListHasPositiveCounts(lines)).toBe(true)
  })

  it('parses .dat image lines and .txt folder lines', () => {
    expect(parseDatImageLines('C:\\a\\1.jpg\n\nC:\\b\\2.png\n')).toEqual([
      'C:\\a\\1.jpg',
      'C:\\b\\2.png'
    ])
    expect(parseTxtFolderLines('C:\\photos\nD:\\more |=> 3\n')).toEqual([
      { folder: 'C:\\photos', count: 1 },
      { folder: 'D:\\more', count: 3 }
    ])
  })
})
