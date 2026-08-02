import { describe, expect, it } from 'vitest'
import { compileViewFilter, isExcludedByViewFilter } from '../renderer/lib/viewFilter'

describe('compileViewFilter', () => {
  it('returns a no-op when disabled or empty', () => {
    expect(compileViewFilter(['*\\node_modules'], false)('D:\\x\\node_modules')).toBe(false)
    expect(compileViewFilter([], true)('D:\\x\\node_modules')).toBe(false)
  })

  it('hides a name everywhere with *\\name', () => {
    const f = compileViewFilter(['*\\node_modules'], true)
    expect(f('C:\\proj\\node_modules')).toBe(true)
    expect(f('D:\\a\\b\\node_modules')).toBe(true)
    expect(f('D:\\a\\my_node_modules')).toBe(false)
    expect(f('D:\\a\\node_modules_old')).toBe(false)
  })

  it('hides descendants of a hidden folder', () => {
    const f = compileViewFilter(['*\\node_modules'], true)
    expect(f('C:\\proj\\node_modules\\react\\index.js')).toBe(true)
  })

  it('hides an exact absolute path and its contents', () => {
    const f = compileViewFilter(['D:\\folder\\foldername'], true)
    expect(f('D:\\folder\\foldername')).toBe(true)
    expect(f('D:\\folder\\foldername\\inside.txt')).toBe(true)
    expect(f('D:\\folder\\foldername2')).toBe(false)
    expect(f('C:\\folder\\foldername')).toBe(false)
  })

  it('is case-insensitive and accepts forward slashes', () => {
    const f = compileViewFilter(['d:/Folder/Sub'], true)
    expect(f('D:\\folder\\sub')).toBe(true)
  })

  it('supports wildcards inside names', () => {
    const f = compileViewFilter(['*\\*.tmp', '*\\cache*'], true)
    expect(f('C:\\a\\b\\junk.tmp')).toBe(true)
    expect(f('C:\\a\\b\\junk.tmpx')).toBe(false)
    expect(f('C:\\a\\cache')).toBe(true)
    expect(f('C:\\a\\cache-v2')).toBe(true)
    expect(f('C:\\a\\mycache')).toBe(false)
  })

  it('treats ? as a single character within a name', () => {
    const f = compileViewFilter(['*\\v?'], true)
    expect(f('C:\\x\\v1')).toBe(true)
    expect(f('C:\\x\\v12')).toBe(false)
    expect(f('C:\\x\\v')).toBe(false)
  })

  it('treats bare names as everywhere patterns', () => {
    const f = compileViewFilter(['Thumbs.db'], true)
    expect(f('C:\\pics\\Thumbs.db')).toBe(true)
    expect(f('C:\\pics\\NotThumbs.db')).toBe(false)
  })

  it('treats relative multi-segment patterns as everywhere patterns', () => {
    const f = compileViewFilter(['build\\temp'], true)
    expect(f('C:\\proj\\build\\temp')).toBe(true)
    expect(f('C:\\proj\\temp')).toBe(false)
  })

  it('ignores blanks, comments and trailing separators', () => {
    const f = compileViewFilter(['', '  ', '# a comment', 'D:\\x\\'], true)
    expect(f('D:\\x')).toBe(true)
    expect(f('D:\\y')).toBe(false)
  })

  it('matches UNC paths', () => {
    const f = compileViewFilter(['\\\\server\\share\\secret'], true)
    expect(f('\\\\server\\share\\secret')).toBe(true)
    expect(f('\\\\server\\share\\secret\\file.txt')).toBe(true)
    expect(f('\\\\server\\share\\open')).toBe(false)
  })
})

describe('isExcludedByViewFilter', () => {
  it('hides Windows Hidden items when filter is enabled', () => {
    expect(
      isExcludedByViewFilter({ path: 'C:\\pagefile.sys', isHidden: true }, [], true)
    ).toBe(true)
    expect(
      isExcludedByViewFilter({ path: 'C:\\pagefile.sys', isHidden: true }, [], false)
    ).toBe(false)
  })

  it('still applies patterns when enabled', () => {
    expect(
      isExcludedByViewFilter(
        { path: 'C:\\proj\\node_modules', isHidden: false },
        ['*\\node_modules'],
        true
      )
    ).toBe(true)
  })
})
