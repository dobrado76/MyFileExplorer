import { describe, expect, it } from 'vitest'
import {
  collapseMenuSeparators,
  isContextMenuBuiltinEnabled,
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
