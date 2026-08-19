import { describe, expect, it } from 'vitest'
import { recycleBinItemsToEntries } from '../renderer/lib/recycleBinEntries'
import type { RecycleBinItem } from '../shared/schemas/recycle'

describe('recycleBinItemsToEntries', () => {
  it('keeps two deletes of the same original path as two rows', () => {
    const items: RecycleBinItem[] = [
      {
        name: 'file.ext',
        originalPath: 'D:\\repo\\file.ext',
        recyclePath: 'C:\\$Recycle.Bin\\S-1-1\\$R1',
        isDir: false,
        size: 10,
        dateDeletedMs: 100,
        deletedFrom: 'D:\\repo'
      },
      {
        name: 'file.ext',
        originalPath: 'D:\\repo\\file.ext',
        recyclePath: 'C:\\$Recycle.Bin\\S-1-1\\$R2',
        isDir: false,
        size: 20,
        dateDeletedMs: 200,
        deletedFrom: 'D:\\repo'
      },
      {
        name: 'other',
        originalPath: 'D:\\repo\\other',
        recyclePath: 'C:\\$Recycle.Bin\\S-1-1\\$R3',
        isDir: true,
        size: 0,
        dateDeletedMs: 150,
        deletedFrom: 'D:\\repo'
      }
    ]
    const entries = recycleBinItemsToEntries(items)
    expect(entries).toHaveLength(3)
    const twins = entries.filter((e) => e.name === 'file.ext')
    expect(twins).toHaveLength(2)
    expect(twins.map((e) => e.path).sort()).toEqual([
      'C:\\$Recycle.Bin\\S-1-1\\$R1',
      'C:\\$Recycle.Bin\\S-1-1\\$R2'
    ])
    expect(new Set(entries.map((e) => e.path.toLowerCase())).size).toBe(entries.length)
  })

  it('dedupes true Shell duplicates (same recyclePath)', () => {
    const items: RecycleBinItem[] = [
      {
        name: 'test copy',
        originalPath: 'D:\\repo\\test copy',
        recyclePath: 'C:\\$Recycle.Bin\\S-1-1\\$R1',
        isDir: true,
        size: 0,
        dateDeletedMs: 100,
        deletedFrom: 'D:\\repo'
      },
      {
        name: 'test copy',
        originalPath: 'D:\\repo\\test copy',
        recyclePath: 'C:\\$Recycle.Bin\\S-1-1\\$R1',
        isDir: true,
        size: 0,
        dateDeletedMs: 200,
        deletedFrom: 'D:\\repo'
      }
    ]
    const entries = recycleBinItemsToEntries(items)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.mtimeMs).toBe(200)
  })
})
