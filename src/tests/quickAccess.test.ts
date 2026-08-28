import { describe, expect, it } from 'vitest'
import {
  buildQuickAccess,
  materializeQuickAccessList,
  materializeQuickAccessTokens,
  type KnownFolder
} from '../renderer/lib/quickAccess'
import { nextQuickAccessGroupName } from '../shared/schemas/quickAccess'

const known: KnownFolder[] = [
  { id: 'desktop', label: 'Desktop', path: 'C:\\Users\\x\\Desktop' },
  { id: 'downloads', label: 'Downloads', path: 'C:\\Users\\x\\Downloads' },
  { id: 'documents', label: 'Documents', path: 'C:\\Users\\x\\Documents' },
  { id: 'pictures', label: 'Pictures', path: 'C:\\Users\\x\\Pictures' },
  { id: 'home', label: 'User folder', path: 'C:\\Users\\x' }
]

describe('materializeQuickAccessTokens', () => {
  it('uses factory defaults when unset', () => {
    expect(materializeQuickAccessTokens([], [], [])).toEqual([
      'desktop',
      'downloads',
      'documents',
      'pictures'
    ])
  })

  it('migrates legacy pin/hidden fields', () => {
    expect(
      materializeQuickAccessTokens([], ['D:\\Projects', 'C:\\Users\\x'], ['pictures', 'downloads'])
    ).toEqual(['desktop', 'documents', 'D:\\Projects', 'C:\\Users\\x'])
  })

  it('prefers explicit quickAccess list', () => {
    expect(materializeQuickAccessTokens(['home', 'D:\\Work'], ['ignored'], ['desktop'])).toEqual([
      'home',
      'D:\\Work'
    ])
  })
})

describe('grouped quick access (D58)', () => {
  it('flattens group pins for lookup', () => {
    const list = materializeQuickAccessList(
      [
        'desktop',
        {
          kind: 'group',
          id: 'qag_test1_abcd',
          name: 'Work',
          collapsed: false,
          items: ['D:\\Projects']
        }
      ],
      [],
      []
    )
    expect(materializeQuickAccessTokens(list, [], [])).toEqual(['desktop', 'D:\\Projects'])
  })

  it('suggests unique default group names', () => {
    expect(nextQuickAccessGroupName([])).toBe('Group')
    expect(
      nextQuickAccessGroupName([
        { kind: 'group', id: 'qag_a1_xxxx', name: 'Group', collapsed: false, items: [] }
      ])
    ).toBe('Group 2')
    expect(
      nextQuickAccessGroupName([
        { kind: 'group', id: 'qag_a1_xxxx', name: 'Group', collapsed: false, items: [] },
        { kind: 'group', id: 'qag_a2_yyyy', name: 'Group 2', collapsed: false, items: [] }
      ])
    ).toBe('Group 3')
  })
})

describe('buildQuickAccess', () => {
  it('lists default builtins in order', () => {
    const tokens = materializeQuickAccessTokens([], [], [])
    const entries = buildQuickAccess(known, tokens)
    expect(entries.map((e) => e.label)).toEqual([
      'Desktop',
      'Downloads',
      'Documents',
      'Pictures'
    ])
  })

  it('respects custom order and paths', () => {
    const entries = buildQuickAccess(known, ['pictures', 'D:\\Projects', 'home'])
    expect(entries.map((e) => e.label)).toEqual(['Pictures', 'Projects', 'User folder'])
  })
})
