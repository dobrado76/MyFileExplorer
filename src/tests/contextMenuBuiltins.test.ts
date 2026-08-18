import { describe, expect, it } from 'vitest'
import {
  CONTEXT_MENU_BUILTIN_IDS,
  DEFAULT_CONTEXT_MENU_BUILTIN_LAYOUT,
  applyBuiltinLayoutToMenu,
  collapseMenuSeparators,
  isContextMenuBuiltinEnabled,
  sanitizeBuiltinLayout,
  sanitizeHiddenBuiltins
} from '../shared/contextMenuBuiltins'

describe('sanitizeHiddenBuiltins', () => {
  it('keeps known ids and drops junk', () => {
    expect(sanitizeHiddenBuiltins(['open', 'nope', 'open', 'properties'])).toEqual([
      'open',
      'properties'
    ])
  })
})

describe('isContextMenuBuiltinEnabled', () => {
  it('defaults to shown', () => {
    expect(isContextMenuBuiltinEnabled(undefined, 'open')).toBe(true)
    expect(isContextMenuBuiltinEnabled([], 'open')).toBe(true)
  })

  it('hides listed ids', () => {
    expect(isContextMenuBuiltinEnabled(['power-rename', 'alternate-streams'], 'power-rename')).toBe(
      false
    )
    expect(isContextMenuBuiltinEnabled(['power-rename'], 'open')).toBe(true)
  })
})

describe('collapseMenuSeparators', () => {
  it('removes duplicate and edge separators', () => {
    const items = [
      { type: 'sep' },
      { type: 'item' },
      { type: 'sep' },
      { type: 'sep' },
      { type: 'item' },
      { type: 'sep' }
    ]
    expect(collapseMenuSeparators(items).map((i) => i.type)).toEqual(['item', 'sep', 'item'])
  })
})

describe('sanitizeBuiltinLayout', () => {
  it('returns default layout when empty', () => {
    expect(sanitizeBuiltinLayout(undefined)).toEqual(DEFAULT_CONTEXT_MENU_BUILTIN_LAYOUT)
    expect(sanitizeBuiltinLayout([])).toEqual(DEFAULT_CONTEXT_MENU_BUILTIN_LAYOUT)
  })

  it('keeps user order, seps, and appends missing ids with properties last', () => {
    const layout = sanitizeBuiltinLayout([
      { type: 'item', id: 'properties' },
      { type: 'sep', id: 's1' },
      { type: 'item', id: 'open' },
      { type: 'item', id: 'nope' }
    ])
    expect(layout[0]).toEqual({ type: 'sep', id: 's1' })
    expect(layout[1]).toEqual({ type: 'item', id: 'open' })
    const ids = layout.filter((e) => e.type === 'item').map((e) => e.id)
    expect(ids).toHaveLength(CONTEXT_MENU_BUILTIN_IDS.length)
    expect(new Set(ids).size).toBe(CONTEXT_MENU_BUILTIN_IDS.length)
    expect(ids[ids.length - 1]).toBe('properties')
  })

  it('default layout places Calculate Statistics above Properties', () => {
    const itemIds = DEFAULT_CONTEXT_MENU_BUILTIN_LAYOUT.filter((e) => e.type === 'item').map(
      (e) => e.id
    )
    expect(itemIds[itemIds.length - 1]).toBe('properties')
    expect(itemIds[itemIds.length - 2]).toBe('calculate-folder-statistics')
  })

  it('places This PC tools above Map network drive', () => {
    const itemIds = DEFAULT_CONTEXT_MENU_BUILTIN_LAYOUT.filter((e) => e.type === 'item').map(
      (e) => e.id
    )
    expect(itemIds.indexOf('computer-manager')).toBeLessThan(itemIds.indexOf('device-manager'))
    expect(itemIds.indexOf('device-manager')).toBeLessThan(itemIds.indexOf('control-panel'))
    expect(itemIds.indexOf('control-panel')).toBeLessThan(itemIds.indexOf('map-network-drive'))
  })

  it('inserts missing This PC tools before Map network drive on existing layouts', () => {
    const layout = sanitizeBuiltinLayout([
      { type: 'item', id: 'open' },
      { type: 'item', id: 'map-network-drive' },
      { type: 'item', id: 'properties' }
    ])
    const ids = layout.filter((e) => e.type === 'item').map((e) => e.id)
    expect(ids.indexOf('computer-manager')).toBeLessThan(ids.indexOf('map-network-drive'))
    expect(ids.indexOf('device-manager')).toBeLessThan(ids.indexOf('map-network-drive'))
    expect(ids.indexOf('control-panel')).toBeLessThan(ids.indexOf('map-network-drive'))
    expect(ids[ids.length - 1]).toBe('properties')
  })
})

describe('applyBuiltinLayoutToMenu', () => {
  it('reorders builtins and inserts layout separators', () => {
    type M = { type: string; builtin?: 'open' | 'copy' | 'properties'; label?: string }
    const items: M[] = [
      { type: 'item', builtin: 'copy', label: 'Copy' },
      { type: 'sep' },
      { type: 'item', builtin: 'open', label: 'Open' },
      { type: 'item', label: 'Custom' },
      { type: 'item', builtin: 'properties', label: 'Properties' }
    ]
    const out = applyBuiltinLayoutToMenu(items, [
      { type: 'item', id: 'open' },
      { type: 'sep', id: 's' },
      { type: 'item', id: 'properties' },
      { type: 'item', id: 'copy' }
    ] as const)
    expect(out.map((i) => (i.type === 'sep' ? 'sep' : i.builtin ?? i.label))).toEqual([
      'open',
      'sep',
      'Custom',
      'sep',
      'copy',
      'properties'
    ])
  })
})
