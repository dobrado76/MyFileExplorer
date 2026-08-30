import { describe, expect, it } from 'vitest'
import { pathKey } from '@shared/paths'
import { dirChildrenFromListing, sameDirChildList } from '../renderer/lib/treeFromListing'

describe('dirChildrenFromListing', () => {
  it('keeps folders A–Z and drops files', () => {
    const { dirs, childHidden } = dirChildrenFromListing([
      { path: 'E:\\b.txt', name: 'b.txt', kind: 'file' },
      { path: 'E:\\Zebra', name: 'Zebra', kind: 'dir' },
      { path: 'E:\\alpha', name: 'alpha', kind: 'dir', isHidden: true }
    ])
    expect(dirs).toEqual(['E:\\alpha', 'E:\\Zebra'])
    expect(childHidden['e:\\alpha']).toBe(true)
  })

  it('strips .mfevirtual from tree labels', () => {
    const { childLabels } = dirChildrenFromListing([
      {
        path: 'E:\\Movies\\TestVF.mfevirtual',
        name: 'TestVF.mfevirtual',
        kind: 'dir',
        ext: 'mfevirtual'
      }
    ])
    expect(childLabels['e:\\movies\\testvf.mfevirtual']).toBe('TestVF')
  })

  it('keeps embedded group rows for the tree', () => {
    const { dirs, childLabels } = dirChildrenFromListing([
      {
        path: 'mfe-vfgroup:E%3A%5CMovies%5CTestVF.mfevirtual|g-tt',
        name: 'TT',
        kind: 'dir',
        ext: 'mfevirtual'
      },
      {
        path: 'mfe-vfgroup:E%3A%5CMovies%5CTestVF.mfevirtual|g-uu',
        name: 'UU',
        kind: 'dir',
        ext: 'mfevirtual'
      },
      { path: 'E:\\Movies\\clip.mp4', name: 'clip.mp4', kind: 'file' }
    ])
    expect(dirs).toHaveLength(2)
    expect(childLabels[dirs[0]!.toLowerCase()]).toBe('TT')
    expect(childLabels[dirs[1]!.toLowerCase()]).toBe('UU')
  })
})

describe('sameDirChildList', () => {
  it('compares case-insensitively', () => {
    expect(sameDirChildList(['E:\\Foo'], ['e:\\foo'])).toBe(true)
    expect(sameDirChildList(['E:\\Foo'], ['E:\\Bar'])).toBe(false)
    expect(sameDirChildList(null, [])).toBe(false)
  })
})

describe('pathKey opaque Virtual Folder rows', () => {
  it('does not collapse encoded separators in mfe-vfgroup paths', () => {
    const p =
      'mfe-vfgroup:E%3A%5CMovies%5CTestVF.mfevirtual|5614dc97-226e-4ac5-863c-829b9ed4ed69'
    expect(pathKey(p)).toBe(p.toLowerCase())
    expect(pathKey(p).includes('||')).toBe(false)
    expect(pathKey(p).split('|')).toHaveLength(2)
  })
})
