import { describe, expect, it } from 'vitest'
import {
  buildLayoutFromSnapshot,
  layoutSummary,
  removeLayout,
  renameLayout,
  sanitizeLayoutName,
  upsertLayout,
  workspaceLayoutSchema
} from '../shared/layouts'
import { defaultSettings, settingsSchema } from '../shared/schemas/settings'

const sampleSource = {
  tabs: [
    {
      path: 'D:\\AI\\Training',
      title: 'Training',
      icon: { name: 'Sparkles', color: '#a78bfa' } as const,
      viewMode: 'details' as const,
      sort: { key: 'mtime' as const, dir: 'desc' as const },
      rootPath: 'D:\\AI',
      treeExpanded: ['D:\\AI', 'D:\\AI\\Training']
    },
    {
      path: 'D:\\AI\\Outputs',
      title: null,
      icon: null,
      viewMode: 'largeIcons' as const,
      sort: { key: 'name' as const, dir: 'asc' as const },
      rootPath: null,
      treeExpanded: []
    }
  ],
  activeTabIndex: 1,
  splitters: {
    treeWidthPx: 280,
    previewWidthPx: 360,
    treeCollapsed: false,
    previewCollapsed: true
  },
  viewLayout: 1 as const,
  paneTabIds: ['tab_a', 'tab_b'],
  paneTreeCollapsed: [false],
  tabIds: ['tab_a', 'tab_b'],
  paneSplitCols: 0.5,
  paneSplitRows: 0.5
}

describe('layouts', () => {
  it('sanitizes names', () => {
    expect(sanitizeLayoutName('  AI training  ')).toBe('AI training')
    expect(sanitizeLayoutName('   ')).toBeNull()
  })

  it('captures tabs and chrome without history/selection', () => {
    const layout = buildLayoutFromSnapshot('AI training', sampleSource)
    expect(layout.name).toBe('AI training')
    expect(layout.tabs).toHaveLength(2)
    expect(layout.tabs[0]?.title).toBe('Training')
    expect(layout.tabs[0]?.icon).toEqual({ name: 'Sparkles', color: '#a78bfa' })
    expect(layout.tabs[0]?.rootPath).toBe('D:\\AI')
    expect(layout.tabs[1]?.icon).toBeNull()
    expect(layout.activeTabIndex).toBe(1)
    expect(layout.splitters.previewCollapsed).toBe(true)
    expect(layoutSummary(layout)).toContain('2 tabs')
  })

  it('persists multi-pane splitter ratios through save and settings round-trip', () => {
    const layout = buildLayoutFromSnapshot('Split workspace', {
      ...sampleSource,
      viewLayout: 4,
      paneTabIds: ['tab_a', 'tab_b', null, null],
      paneTreeCollapsed: [false, true, false, false],
      paneSplitCols: 0.35,
      paneSplitRows: 0.62
    })
    expect(layout.viewLayout).toBe(4)
    expect(layout.paneTreeCollapsed).toEqual([false, true, false, false])
    expect(layout.paneSplitCols).toBe(0.35)
    expect(layout.paneSplitRows).toBe(0.62)

    const parsed = settingsSchema.parse({ layouts: [layout] })
    expect(parsed.layouts).toHaveLength(1)
    expect(parsed.layouts[0]?.paneSplitCols).toBe(0.35)
    expect(parsed.layouts[0]?.paneSplitRows).toBe(0.62)

    const again = workspaceLayoutSchema.parse(JSON.parse(JSON.stringify(parsed.layouts[0])))
    expect(again.paneSplitCols).toBe(0.35)
    expect(again.paneSplitRows).toBe(0.62)
  })

  it('upsert / rename / remove', () => {
    const a = buildLayoutFromSnapshot('A', sampleSource)
    const b = buildLayoutFromSnapshot('B', sampleSource)
    let list = upsertLayout([], a)
    list = upsertLayout(list, b)
    expect(list).toHaveLength(2)
    list = renameLayout(list, a.id, 'Alpha')!
    expect(list.find((l) => l.id === a.id)?.name).toBe('Alpha')
    list = removeLayout(list, b.id)
    expect(list.map((l) => l.id)).toEqual([a.id])
  })

  it('settings schema keeps layouts and drops invalid ones', () => {
    const good = buildLayoutFromSnapshot('Coding', sampleSource)
    const parsed = settingsSchema.parse({
      layouts: [good, { id: 'bad', name: 'x', tabs: [] }, { not: 'a layout' }]
    })
    expect(parsed.layouts).toHaveLength(1)
    expect(parsed.layouts[0]?.name).toBe('Coding')
    expect(settingsSchema.parse({}).layouts).toEqual([])
    expect(defaultSettings.layouts).toEqual([])
  })

  it('workspaceLayoutSchema rejects empty tabs', () => {
    expect(workspaceLayoutSchema.safeParse({ id: 'x', name: 'x', tabs: [] }).success).toBe(false)
  })
})
