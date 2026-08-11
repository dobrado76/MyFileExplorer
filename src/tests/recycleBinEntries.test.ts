import { describe, expect, it } from 'vitest'
import { recycleBinItemsToEntries } from '../renderer/lib/recycleBinEntries'
import type { RecycleBinItem } from '../shared/schemas/recycle'

describe('recycleBinItemsToEntries', () => {
  it('dedupes duplicate originalPath rows (keep newest dateDeleted)', () => {
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
        recyclePath: 'C:\\$Recycle.Bin\\S-1-1\\$R2',
        isDir: true,
        size: 0,
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
    expect(entries).toHaveLength(2)
    const dup = entries.find((e) => e.name === 'test copy')
    expect(dup?.mtimeMs).toBe(200)
    expect(new Set(entries.map((e) => e.path.toLowerCase())).size).toBe(entries.length)
  })
})
