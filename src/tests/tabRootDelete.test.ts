import { describe, expect, it } from 'vitest'
import { tabRootDeletePrompt, tabsWhoseRootIsDeleted } from '../renderer/lib/tabRootDelete'

const tabs = [
  { id: 'a', rootPath: 'D:\\Photos', title: 'Photos' },
  { id: 'b', rootPath: 'D:\\Photos\\Trip', title: 'Trip' },
  { id: 'c', rootPath: null, title: null },
  { id: 'd', rootPath: 'C:\\Work', title: 'Work' }
]

describe('tabsWhoseRootIsDeleted', () => {
  it('matches the scoped root itself', () => {
    expect(tabsWhoseRootIsDeleted(tabs, ['D:\\Photos']).map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('matches a parent of a scoped root', () => {
    expect(tabsWhoseRootIsDeleted(tabs, ['D:\\']).map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('ignores deleting a child of the root', () => {
    expect(tabsWhoseRootIsDeleted(tabs, ['D:\\Photos\\Trip\\img.jpg']).map((t) => t.id)).toEqual([])
  })

  it('ignores unscoped tabs', () => {
    expect(tabsWhoseRootIsDeleted(tabs, ['C:\\Users']).map((t) => t.id)).toEqual([])
  })
})

describe('tabRootDeletePrompt', () => {
  it('names one folder and one tab', () => {
    const p = tabRootDeletePrompt([tabs[3]!], false)
    expect(p.title).toMatch(/tab root/)
    expect(p.message).toContain('Work')
    expect(p.message).toContain('will be closed')
    expect(p.message).not.toContain('permanently')
  })

  it('mentions permanent delete', () => {
    const p = tabRootDeletePrompt([tabs[3]!], true)
    expect(p.message).toContain('permanently deleted')
  })

  it('names two folders', () => {
    const p = tabRootDeletePrompt([tabs[0]!, tabs[3]!], false)
    expect(p.title).toMatch(/tab roots/)
    expect(p.message).toContain('Photos')
    expect(p.message).toContain('Work')
    expect(p.message).toContain('will be closed')
  })
})
