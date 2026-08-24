import { describe, it, expect } from 'vitest'
import { sessionSchema, defaultSession, isThumbnailViewMode } from '../shared/schemas/session'
import { settingsSchema, defaultSettings } from '../shared/schemas/settings'

describe('session schema migration', () => {
  it('parses a full valid session', () => {
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: 'tab_a',
      tabs: [
        {
          id: 'tab_a',
          path: 'C:\\Users',
          title: null,
          viewMode: 'largeIcons',
          sort: { key: 'name', dir: 'asc' },
          historyBack: [],
          historyForward: [],
          selectedPaths: [],
          scrollOffset: 0
        }
      ],
      splitters: {
        treeWidthPx: 200,
        previewWidthPx: 300,
        treeCollapsed: false,
        previewCollapsed: true
      }
    })
    expect(parsed.tabs).toHaveLength(1)
    expect(parsed.splitters.previewCollapsed).toBe(true)
  })

  it('fills defaults for an old/partial tab shape', () => {
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: 'tab_b',
      tabs: [{ id: 'tab_b', path: 'D:\\Art' }],
      splitters: {}
    })
    const tab = parsed.tabs[0]!
    expect(tab.viewMode).toBe('largeIcons')
    expect(tab.sort).toEqual({ key: 'name', dir: 'asc' })
    expect(tab.historyBack).toEqual([])
    expect(tab.scrollOffset).toBe(0)
    expect(tab.treeExpanded).toEqual([])
    expect(tab.rootPath).toBeNull()
    expect(tab.icon).toBeNull()
    expect(tab.search).toEqual({ active: false, query: '', indexedOnly: false })
    expect(parsed.splitters.treeWidthPx).toBe(240)
  })

  it('keeps default Computer tab icon (Monitor blue)', () => {
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: 't',
      tabs: [
        {
          id: 't',
          path: 'C:\\Users\\me',
          icon: { name: 'Monitor', color: '#60a5fa' }
        }
      ],
      splitters: {}
    })
    expect(parsed.tabs[0]!.icon).toEqual({ name: 'Monitor', color: '#60a5fa' })
  })

  it('keeps a custom tab icon (D54)', () => {
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: 't',
      tabs: [
        {
          id: 't',
          path: 'C:\\Cats',
          icon: { kind: 'custom', id: 'ti_abc1_xyz2', showLabel: false, sizePx: 72 }
        }
      ],
      splitters: {}
    })
    expect(parsed.tabs[0]!.icon).toEqual({
      kind: 'custom',
      id: 'ti_abc1_xyz2',
      showLabel: false,
      sizePx: 72
    })
  })

  it('drops a custom tab icon with a bad id', () => {
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: 't',
      tabs: [
        {
          id: 't',
          path: 'C:\\',
          icon: { kind: 'custom', id: '../x', showLabel: true, sizePx: 32 }
        }
      ],
      splitters: {}
    })
    expect(parsed.tabs[0]!.icon).toBeNull()
  })

  it('keeps tab icon name and color', () => {
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: 't',
      tabs: [
        {
          id: 't',
          path: 'C:\\',
          icon: { name: 'FolderOpen', color: '#34d399' }
        }
      ],
      splitters: {}
    })
    expect(parsed.tabs[0]!.icon).toEqual({ name: 'FolderOpen', color: '#34d399' })
  })

  it('keeps treeExpanded paths and caps the list', () => {
    const many = Array.from({ length: 500 }, (_, i) => `C:\\d${i}`)
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: 't',
      tabs: [{ id: 't', path: 'C:\\', treeExpanded: many }],
      splitters: {}
    })
    expect(parsed.tabs[0]!.treeExpanded).toHaveLength(400)
    expect(parsed.tabs[0]!.treeExpanded[0]).toBe('C:\\d0')
  })

  it('coerces invalid enum values to defaults instead of failing', () => {
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: null,
      tabs: [{ id: 't', path: 'C:\\', viewMode: 'gallery', sort: { key: 'color', dir: 'up' } }],
      splitters: { treeWidthPx: 'wide' }
    })
    expect(parsed.tabs[0]!.viewMode).toBe('largeIcons')
    expect(parsed.tabs[0]!.sort.key).toBe('name')
    expect(parsed.splitters.treeWidthPx).toBe(240)
  })

  it('default session is stable', () => {
    expect(sessionSchema.parse(defaultSession)).toEqual(defaultSession)
  })

  it('defaults closedTabs to empty and caps at 25 (D55)', () => {
    const empty = sessionSchema.parse({
      version: 1,
      activeTabId: 't',
      tabs: [{ id: 't', path: 'C:\\' }],
      splitters: {}
    })
    expect(empty.closedTabs).toEqual([])

    const many = Array.from({ length: 40 }, (_, i) => ({
      tab: { id: `c${i}`, path: `C:\\d${i}` },
      paneIndex: 0
    }))
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: 't',
      tabs: [{ id: 't', path: 'C:\\' }],
      splitters: {},
      closedTabs: many
    })
    expect(parsed.closedTabs).toHaveLength(25)
    expect(parsed.closedTabs[0]!.tab.path).toBe('C:\\d0')
    expect(parsed.closedTabs[0]!.paneIndex).toBe(0)
  })

  it('defaults multi-view fields and seeds paneTabIds from activeTabId', () => {
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: 'tab_a',
      tabs: [{ id: 'tab_a', path: 'C:\\' }],
      splitters: {}
    })
    expect(parsed.viewLayout).toBe(1)
    expect(parsed.paneTabIds).toEqual(['tab_a'])
    expect(parsed.paneTreeCollapsed).toEqual([false])
    expect(parsed.focusedPaneIndex).toBe(0)
    expect(parsed.paneSplitCols).toBe(0.5)
  })

  it('keeps 3-pane layout and migrates global treeCollapsed onto each pane', () => {
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: 'tab_a',
      tabs: [{ id: 'tab_a', path: 'C:\\' }],
      viewLayout: 3,
      paneTabIds: ['tab_a', null, null],
      splitters: { treeCollapsed: true }
    })
    expect(parsed.viewLayout).toBe(3)
    expect(parsed.paneTreeCollapsed).toEqual([true, true, true])
  })

  it('migrates legacy historyBack path strings to folder entries', () => {
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: 't',
      tabs: [
        {
          id: 't',
          path: 'C:\\Data\\Photos',
          historyBack: ['C:\\Data', 'C:\\'],
          historyForward: ['C:\\Data\\Photos\\2024']
        }
      ],
      splitters: {}
    })
    expect(parsed.tabs[0]!.historyBack).toEqual([
      { kind: 'folder', path: 'C:\\Data' },
      { kind: 'folder', path: 'C:\\' }
    ])
    expect(parsed.tabs[0]!.historyForward).toEqual([
      { kind: 'folder', path: 'C:\\Data\\Photos\\2024' }
    ])
    expect(parsed.tabs[0]!.search).toEqual({ active: false, query: '', indexedOnly: false })
  })

  it('keeps folder scrollOffset on history entries', () => {
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: 't',
      tabs: [
        {
          id: 't',
          path: 'C:\\Data',
          historyBack: [{ kind: 'folder', path: 'C:\\Data', scrollOffset: 880 }]
        }
      ],
      splitters: {}
    })
    expect(parsed.tabs[0]!.historyBack[0]).toEqual({
      kind: 'folder',
      path: 'C:\\Data',
      scrollOffset: 880
    })
  })

  it('keeps a persisted search location on the tab', () => {
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: 't',
      tabs: [
        {
          id: 't',
          path: 'C:\\Data',
          historyBack: [
            { kind: 'folder', path: 'C:\\Data' },
            { kind: 'search', query: '!!Thumbs.db', scopePath: 'C:\\Data', indexedOnly: false }
          ],
          search: { active: true, query: '!!Thumbs.db', indexedOnly: false }
        }
      ],
      splitters: {}
    })
    expect(parsed.tabs[0]!.search).toEqual({
      active: true,
      query: '!!Thumbs.db',
      indexedOnly: false
    })
    expect(parsed.tabs[0]!.historyBack[1]).toEqual({
      kind: 'search',
      query: '!!Thumbs.db',
      scopePath: 'C:\\Data',
      indexedOnly: false
    })
  })

  it('keeps 2-pane layout assignments', () => {
    const parsed = sessionSchema.parse({
      version: 1,
      activeTabId: 'tab_b',
      tabs: [
        { id: 'tab_a', path: 'C:\\' },
        { id: 'tab_b', path: 'D:\\' }
      ],
      viewLayout: 2,
      paneTabIds: ['tab_a', 'tab_b'],
      focusedPaneIndex: 1,
      paneSplitCols: 0.4
    })
    expect(parsed.viewLayout).toBe(2)
    expect(parsed.paneTabIds).toEqual(['tab_a', 'tab_b'])
    expect(parsed.focusedPaneIndex).toBe(1)
    expect(parsed.paneSplitCols).toBe(0.4)
  })
})

describe('isThumbnailViewMode', () => {
  it('is true for icon grids and false for list/details', () => {
    expect(isThumbnailViewMode('extraLargeIconsNoName')).toBe(true)
    expect(isThumbnailViewMode('extraLargeIcons')).toBe(true)
    expect(isThumbnailViewMode('largeIcons')).toBe(true)
    expect(isThumbnailViewMode('mediumIcons')).toBe(true)
    expect(isThumbnailViewMode('smallIcons')).toBe(true)
    expect(isThumbnailViewMode('list')).toBe(false)
    expect(isThumbnailViewMode('details')).toBe(false)
  })
})

describe('settings schema migration', () => {
  it('fills all defaults from empty object', () => {
    const parsed = settingsSchema.parse({})
    expect(parsed).toEqual(defaultSettings)
  })
  it('keeps unknown themes out', () => {
    const parsed = settingsSchema.parse({ theme: 'hotdog' })
    expect(parsed.theme).toBe('dark')
  })
  it('clamps invalid font size to default', () => {
    expect(settingsSchema.parse({ fontSizePx: 900 }).fontSizePx).toBe(13)
    expect(settingsSchema.parse({}).vidThumbFrameMs).toBe(300)
    expect(settingsSchema.parse({ vidThumbFrameMs: 10 }).vidThumbFrameMs).toBe(300)
    expect(settingsSchema.parse({ vidThumbFrameMs: 500 }).vidThumbFrameMs).toBe(500)
  })
})
