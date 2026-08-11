import { describe, expect, it } from 'vitest'
import { dedupeDirEntries } from '../shared/dirEntries'
import type { DirEntry } from '../shared/schemas/fs'

function entry(path: string, name?: string): DirEntry {
  return {
    name: name ?? path.split('\\').pop()!,
    path,
    kind: 'dir',
    size: 0,
    mtimeMs: 1,
    birthtimeMs: 1,
    ext: '',
    isHidden: false
  }
}

describe('dedupeDirEntries', () => {
  it('keeps first of case-insensitive duplicate paths', () => {
    const a = entry('D:\\repo\\test copy')
    const b = entry('D:\\repo\\Test Copy')
    const c = entry('D:\\repo\\other')
    const out = dedupeDirEntries([a, b, c])
    expect(out).toEqual([a, c])
  })
})
