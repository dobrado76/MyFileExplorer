import { describe, expect, it } from 'vitest'
import { entrySizeSortBytes } from '../renderer/lib/sizeSort'
import type { DirEntry } from '../shared/schemas/fs'

function file(size: number): Pick<DirEntry, 'kind' | 'size'> {
  return { kind: 'file', size }
}

function dir(size = 0): Pick<DirEntry, 'kind' | 'size'> {
  return { kind: 'dir', size }
}

describe('entrySizeSortBytes', () => {
  it('uses listing size for files', () => {
    expect(entrySizeSortBytes(file(1234))).toBe(1234)
    expect(entrySizeSortBytes(file(0))).toBe(0)
  })

  it('uses TotalSize ADS digits for folders (listing size stays 0)', () => {
    expect(entrySizeSortBytes(dir(0), '8900000000000')).toBe(8900000000000)
    expect(entrySizeSortBytes(dir(0), '476000000')).toBe(476000000)
    expect(entrySizeSortBytes(dir(99), '1000')).toBe(1000)
  })

  it('treats missing or non-digit folder meta as 0', () => {
    expect(entrySizeSortBytes(dir())).toBe(0)
    expect(entrySizeSortBytes(dir(), '')).toBe(0)
    expect(entrySizeSortBytes(dir(), '8.9 TB')).toBe(0)
    expect(entrySizeSortBytes(dir(), null)).toBe(0)
  })

  it('orders folders by TotalSize bytes, not display strings or listing size', () => {
    const rows = [
      { name: 'a', entry: dir(), meta: '21500000000' }, // 21.5 GB
      { name: 'b', entry: dir(), meta: '160000000000' }, // 160 GB
      { name: 'c', entry: dir(), meta: '8900000000000' }, // 8.9 TB
      { name: 'd', entry: dir(), meta: '476000000' }, // 476 MB
      { name: 'e', entry: dir(), meta: '0' }
    ]
    const asc = [...rows].sort(
      (x, y) => entrySizeSortBytes(x.entry, x.meta) - entrySizeSortBytes(y.entry, y.meta)
    )
    expect(asc.map((r) => r.name)).toEqual(['e', 'd', 'a', 'b', 'c'])
    const desc = [...rows].sort(
      (x, y) => entrySizeSortBytes(y.entry, y.meta) - entrySizeSortBytes(x.entry, x.meta)
    )
    expect(desc.map((r) => r.name)).toEqual(['c', 'b', 'a', 'd', 'e'])
  })
})
