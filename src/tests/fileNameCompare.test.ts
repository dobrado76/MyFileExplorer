import { describe, expect, it } from 'vitest'
import { compareFileNames } from '../shared/fileNameCompare'

function sorted(names: string[]): string[] {
  return [...names].sort(compareFileNames)
}

describe('compareFileNames (Explorer StrCmpLogicalW)', () => {
  it('keeps zero-padding groups like Explorer (not Intl numeric)', () => {
    expect(
      sorted([
        '2_2.jpg',
        '02_3.jpg',
        '2_7.jpg',
        '002_8.jpg',
        '2_8.jpg',
        '02_9.jpg',
        '2_10 (2).jpg',
        '002_071.jpg',
        '2_98.jpg',
        '2_355.jpg',
        '2_987029782.jpg',
        '2_1157155299.jpg',
        '002_1551807671.jpg',
        '02_1247836884023.jpg',
        '002_20140620203121c67.jpg',
        '0002_2014050518332695e.jpg'
      ])
    ).toEqual([
      '0002_2014050518332695e.jpg',
      '002_8.jpg',
      '002_071.jpg',
      '002_1551807671.jpg',
      '002_20140620203121c67.jpg',
      '02_3.jpg',
      '02_9.jpg',
      '02_1247836884023.jpg',
      '2_2.jpg',
      '2_7.jpg',
      '2_8.jpg',
      '2_10 (2).jpg',
      '2_98.jpg',
      '2_355.jpg',
      '2_987029782.jpg',
      '2_1157155299.jpg'
    ])
  })

  it('orders digit runs by value (file2 before file10)', () => {
    expect(sorted(['file10.txt', 'file2.txt', 'file02.txt'])).toEqual([
      'file02.txt',
      'file2.txt',
      'file10.txt'
    ])
  })

  it('puts more leading zeros first when values match', () => {
    expect(compareFileNames('02', '2')).toBeLessThan(0)
    expect(compareFileNames('002', '02')).toBeLessThan(0)
    expect(compareFileNames('0002', '002')).toBeLessThan(0)
    expect(sorted(['x1', 'x0', 'x00'])).toEqual(['x00', 'x0', 'x1'])
  })

  it('ignores ASCII letter case', () => {
    expect(compareFileNames('A', 'a')).toBe(0)
    expect(compareFileNames('img', 'IMG')).toBe(0)
  })
})
