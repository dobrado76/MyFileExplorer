import { describe, it, expect } from 'vitest'
import {
  normalizeSlashes,
  joinPath,
  segmentsOf,
  parentOf,
  basename,
  samePath,
  isRootPath,
  rootOf,
  looksAbsolute
} from '../renderer/lib/paths'

describe('normalizeSlashes', () => {
  it('collapses duplicate separators', () => {
    expect(normalizeSlashes('C:\\\\Users\\\\x')).toBe('C:\\Users\\x')
    expect(normalizeSlashes('C:/Users//x')).toBe('C:\\Users\\x')
  })
  it('preserves UNC prefix', () => {
    expect(normalizeSlashes('\\\\server\\share\\dir')).toBe('\\\\server\\share\\dir')
    expect(normalizeSlashes('//server/share')).toBe('\\\\server\\share')
  })
})

describe('joinPath', () => {
  it('joins under a drive root without doubling separators', () => {
    expect(joinPath('C:\\', 'Users')).toBe('C:\\Users')
  })
  it('joins normal dirs', () => {
    expect(joinPath('C:\\Users', 'domin')).toBe('C:\\Users\\domin')
    expect(joinPath('C:\\Users\\', 'domin')).toBe('C:\\Users\\domin')
  })
})

describe('segmentsOf', () => {
  it('builds drive segments with single separators', () => {
    expect(segmentsOf('C:\\Users\\x')).toEqual([
      { label: 'C:', path: 'C:\\' },
      { label: 'Users', path: 'C:\\Users' },
      { label: 'x', path: 'C:\\Users\\x' }
    ])
  })
  it('builds UNC segments', () => {
    expect(segmentsOf('\\\\srv\\share\\sub')).toEqual([
      { label: '\\\\srv\\share', path: '\\\\srv\\share' },
      { label: 'sub', path: '\\\\srv\\share\\sub' }
    ])
  })
})

describe('parentOf / basename / roots', () => {
  it('walks to the drive root and stops', () => {
    expect(parentOf('C:\\Users\\x')).toBe('C:\\Users')
    expect(parentOf('C:\\Users')).toBe('C:\\')
    expect(parentOf('C:\\')).toBeNull()
  })
  it('basename of root is the drive', () => {
    expect(basename('C:\\')).toBe('C:')
    expect(basename('C:\\Users\\x.txt')).toBe('x.txt')
  })
  it('detects roots', () => {
    expect(isRootPath('C:\\')).toBe(true)
    expect(isRootPath('C:\\Users')).toBe(false)
    expect(rootOf('C:\\Users\\x')).toBe('C:\\')
  })
  it('samePath tolerates separator noise and case', () => {
    expect(samePath('C:\\\\Users', 'c:/users/')).toBe(true)
  })
  it('looksAbsolute accepts drive and UNC forms', () => {
    expect(looksAbsolute('C:\\x')).toBe(true)
    expect(looksAbsolute('\\\\srv\\share')).toBe(true)
    expect(looksAbsolute('relative\\x')).toBe(false)
  })
})
