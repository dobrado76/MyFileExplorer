import { describe, expect, it } from 'vitest'
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
})

describe('sameDirChildList', () => {
  it('compares case-insensitively', () => {
    expect(sameDirChildList(['E:\\Foo'], ['e:\\foo'])).toBe(true)
    expect(sameDirChildList(['E:\\Foo'], ['E:\\Bar'])).toBe(false)
    expect(sameDirChildList(null, [])).toBe(false)
  })
})
