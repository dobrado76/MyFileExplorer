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

  it('keeps user order, seps, and appends missing ids', () => {
    const layout = sanitizeBuiltinLayout([
      { type: 'item', id: 'properties' },
      { type: 'sep', id: 's1' },
      { type: 'item', id: 'open' },
      { type: 'item', id: 'nope' }
    ])
    expect(layout[0]).toEqual({ type: 'item', id: 'properties' })
    expect(layout[1]).toEqual({ type: 'sep', id: 's1' })
    expect(layout[2]).toEqual({ type: 'item', id: 'open' })
    const ids = layout.filter((e) => e.type === 'item').map((e) => e.id)
    expect(ids).toHaveLength(CONTEXT_MENU_BUILTIN_IDS.length)
    expect(new Set(ids).size).toBe(CONTEXT_MENU_BUILTIN_IDS.length)
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
      'properties',
      'copy'
    ])
  })
})
