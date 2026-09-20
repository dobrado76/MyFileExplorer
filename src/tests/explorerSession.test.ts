import { describe, expect, it } from 'vitest'
import { mergeFloatTabs, mergeMainSessionWrite } from '../shared/explorerSession'
import { defaultSession, sessionSchema, type SessionState, type TabState } from '../shared/schemas/session'

function tab(id: string, windowId = 'main'): TabState {
  return {
    id,
    path: `C:\\${id}`,
    title: null,
    icon: null,
    viewMode: 'largeIcons',
    sort: { key: 'name', dir: 'asc' },
    historyBack: [],
    historyForward: [],
    search: { active: false, query: '', indexedOnly: false },
    selectedPaths: [],
    scrollOffset: 0,
    rootPath: null,
    treeExpanded: [],
    virtualFolderGroupStack: [],
    windowId
  }
}

function session(partial: Partial<SessionState>): SessionState {
  return { ...defaultSession, ...partial }
}

describe('explorer session merge', () => {
  it('keeps float tabs when the main shell writes', () => {
    const prev = session({
      tabs: [tab('a', 'main'), tab('b', 'float_1')],
      explorerWindows: [
        { id: 'float_1', kind: 'float', bounds: null, maximized: false, activeTabId: 'b' }
      ]
    })
    const next = mergeMainSessionWrite(prev, session({ tabs: [tab('a', 'main')], activeTabId: 'a' }))
    expect(next.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(next.tabs[1]!.windowId).toBe('float_1')
    expect(next.explorerWindows.map((w) => w.id)).toEqual(['float_1'])
  })

  it('drops a float window once its tabs are merged into the main write', () => {
    const prev = session({
      tabs: [tab('b', 'float_1')],
      explorerWindows: [
        { id: 'float_1', kind: 'float', bounds: null, maximized: false, activeTabId: 'b' }
      ]
    })
    const next = mergeMainSessionWrite(prev, session({ tabs: [tab('a'), tab('b')] }))
    expect(next.tabs.every((t) => t.windowId === 'main')).toBe(true)
    expect(next.explorerWindows).toEqual([])
  })

  it('replaces only the writing float’s tabs', () => {
    const prev = session({
      tabs: [tab('a', 'main'), tab('b', 'float_1'), tab('c', 'float_2')],
      explorerWindows: [
        { id: 'float_1', kind: 'float', bounds: null, maximized: false, activeTabId: 'b' },
        { id: 'float_2', kind: 'float', bounds: null, maximized: false, activeTabId: 'c' }
      ]
    })
    const moved = tab('b2', 'float_1')
    const next = mergeFloatTabs(prev, 'float_1', [moved], 'b2')
    expect(next.tabs.map((t) => `${t.windowId}:${t.id}`).sort()).toEqual([
      'float_1:b2',
      'float_2:c',
      'main:a'
    ])
    expect(next.explorerWindows.find((w) => w.id === 'float_1')?.activeTabId).toBe('b2')
  })
})

describe('session explorer windows', () => {
  it('defaults window ownership and closed windows', () => {
    const parsed = sessionSchema.parse({
      version: 1,
      tabs: [{ id: 't', path: 'C:\\' }],
      splitters: {}
    })
    expect(parsed.tabs[0]!.windowId).toBe('main')
    expect(parsed.explorerWindows).toEqual([])
    expect(parsed.closedWindows).toEqual([])
  })

  it('caps closed windows at 10', () => {
    const closedWindows = Array.from({ length: 12 }, (_, i) => ({
      closedAt: i,
      tabs: [{ tab: { id: `c${i}`, path: 'C:\\' }, paneIndex: 0 }]
    }))
    const parsed = sessionSchema.parse({
      version: 1,
      tabs: [{ id: 't', path: 'C:\\' }],
      splitters: {},
      closedWindows
    })
    expect(parsed.closedWindows).toHaveLength(10)
  })
})
