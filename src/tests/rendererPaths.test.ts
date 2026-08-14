import { describe, it, expect } from 'vitest'
import {
  normalizeSlashes,
  joinPath,
  segmentsOf,
  parentOf,
  basename,
  samePath,
  isUnderPath,
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
  it('builds UNC segments including the host', () => {
    expect(segmentsOf('\\\\srv\\share\\sub')).toEqual([
      { label: 'srv', path: '\\\\srv' },
      { label: 'share', path: '\\\\srv\\share' },
      { label: 'sub', path: '\\\\srv\\share\\sub' }
    ])
  })
  it('builds a single segment for bare UNC hosts', () => {
    expect(segmentsOf('\\\\newonyx')).toEqual([{ label: 'newonyx', path: '\\\\newonyx' }])
  })
})

describe('parentOf / basename / roots', () => {
  it('walks to the drive root and stops', () => {
    expect(parentOf('C:\\Users\\x')).toBe('C:\\Users')
    expect(parentOf('C:\\Users')).toBe('C:\\')
    expect(parentOf('C:\\')).toBeNull()
  })
  it('walks from share up to UNC host', () => {
    expect(parentOf('\\\\srv\\share\\sub')).toBe('\\\\srv\\share')
    expect(parentOf('\\\\srv\\share')).toBe('\\\\srv')
    expect(parentOf('\\\\srv')).toBeNull()
  })
  it('basename of root is the drive', () => {
    expect(basename('C:\\')).toBe('C:')
    expect(basename('C:\\Users\\x.txt')).toBe('x.txt')
    expect(basename('\\\\srv\\share')).toBe('share')
  })
  it('detects roots', () => {
    expect(isRootPath('C:\\')).toBe(true)
    expect(isRootPath('C:\\Users')).toBe(false)
    expect(rootOf('C:\\Users\\x')).toBe('C:\\')
    expect(isRootPath('\\\\srv')).toBe(true)
    expect(isRootPath('\\\\srv\\share')).toBe(false)
    expect(rootOf('\\\\srv\\share\\x')).toBe('\\\\srv\\share')
    expect(rootOf('\\\\srv')).toBe('\\\\srv')
  })
  it('samePath tolerates separator noise and case', () => {
    expect(samePath('C:\\\\Users', 'c:/users/')).toBe(true)
  })
  it('treats C:\\ and C: as the same drive root', () => {
    expect(samePath('Z:\\', 'Z:')).toBe(true)
    expect(samePath('z:\\', 'Z:')).toBe(true)
  })
  it('scopes a drive-as-root tab to the whole volume', () => {
    expect(isUnderPath('Z:\\Games', 'Z:\\')).toBe(true)
    expect(isUnderPath('Z:\\Games\\mod', 'Z:')).toBe(true)
    expect(isUnderPath('Z:\\', 'Z:\\')).toBe(true)
    expect(isUnderPath('C:\\Games', 'Z:\\')).toBe(false)
    expect(isUnderPath('Z:\\Games\\a', 'Z:\\Games')).toBe(true)
  })
  it('looksAbsolute accepts drive and UNC forms', () => {
    expect(looksAbsolute('C:\\x')).toBe(true)
    expect(looksAbsolute('\\\\srv\\share')).toBe(true)
    expect(looksAbsolute('\\\\srv')).toBe(true)
    expect(looksAbsolute('relative\\x')).toBe(false)
  })
})
