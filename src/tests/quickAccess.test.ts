import { describe, expect, it } from 'vitest'
import {
  buildQuickAccess,
  materializeQuickAccessTokens,
  type KnownFolder
} from '../renderer/lib/quickAccess'

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
