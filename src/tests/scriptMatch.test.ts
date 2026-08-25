import { describe, expect, it } from 'vitest'
import {
  applyGlobalScriptRules,
  defaultScriptDefinition,
  isGlobalScript,
  normalizeScriptScopes,
  type ScriptDefinition
} from '../shared/schemas/scripts'
import { groupScriptsByCategory, scriptMatchesMenu } from '../shared/scriptMatch'

function script(partial: Partial<ScriptDefinition>): ScriptDefinition {
  return {
    ...defaultScriptDefinition(),
    id: 's1',
    createdAt: '',
    updatedAt: '',
    ...partial
  }
}

describe('global script scopes', () => {
  it('collapses mixed scopes to global-only', () => {
    expect(normalizeScriptScopes(['folder', 'global'])).toEqual(['global'])
    expect(normalizeScriptScopes(['folder', 'selection'])).toEqual(['folder', 'selection'])
  })

  it('does not throw when scopes are missing', () => {
    expect(isGlobalScript(null)).toBe(false)
    expect(isGlobalScript({ scopes: undefined as unknown as ScriptDefinition['scopes'] })).toBe(false)
    expect(normalizeScriptScopes(undefined)).toEqual(['folder'])
  })

  it('clears folder filters when applying global rules', () => {
    const next = applyGlobalScriptRules(
      script({
        scopes: ['global', 'folder'],
        recursive: true,
        contextMenuEnabled: true,
        matchExtensions: ['jpg'],
        minSelection: 2
      })
    )
    expect(next.scopes).toEqual(['global'])
    expect(next.recursive).toBe(false)
    expect(next.contextMenuEnabled).toBe(false)
    expect(next.matchExtensions).toEqual([])
    expect(next.minSelection).toBe(0)
  })

  it('falls back custom toolbar icon without iconId to Lucide', () => {
    const next = applyGlobalScriptRules(
      script({
        scopes: ['global'],
        iconKind: 'custom',
        iconId: undefined,
        lucideName: 'Zap'
      })
    )
    expect(next.iconKind).toBe('lucide')
    expect(next.lucideName).toBe('Zap')
  })
})

describe('scriptMatchesMenu', () => {
  it('shows folder scripts on empty pane', () => {
    expect(
      scriptMatchesMenu(script({ scopes: ['folder'] }), {
        folderPath: 'D:\\lib',
        selectedPaths: [],
        selectionKind: 'empty'
      })
    ).toBe(true)
  })

  it('hides disabled / wrong scope', () => {
    expect(
      scriptMatchesMenu(script({ contextMenuEnabled: false, scopes: ['folder'] }), {
        folderPath: 'D:\\lib',
        selectedPaths: [],
        selectionKind: 'empty'
      })
    ).toBe(false)
    expect(
      scriptMatchesMenu(script({ scopes: ['selection'] }), {
        folderPath: 'D:\\lib',
        selectedPaths: [],
        selectionKind: 'empty'
      })
    ).toBe(false)
  })

  it('filters selection by extension and min count', () => {
    const s = script({
      scopes: ['selection'],
      matchExtensions: ['jpg'],
      minSelection: 2
    })
    expect(
      scriptMatchesMenu(s, {
        folderPath: 'D:\\lib',
        selectedPaths: ['D:\\lib\\a.jpg'],
        selectionKind: 'file'
      })
    ).toBe(false)
    expect(
      scriptMatchesMenu(s, {
        folderPath: 'D:\\lib',
        selectedPaths: ['D:\\lib\\a.jpg', 'D:\\lib\\b.JPG'],
        selectionKind: 'file'
      })
    ).toBe(true)
    expect(
      scriptMatchesMenu(s, {
        folderPath: 'D:\\lib',
        selectedPaths: ['D:\\lib\\a.jpg', 'D:\\lib\\b.png'],
        selectionKind: 'file'
      })
    ).toBe(false)
  })

  it('never shows global scripts on the context menu', () => {
    expect(
      scriptMatchesMenu(script({ scopes: ['global'], contextMenuEnabled: true }), {
        folderPath: 'D:\\lib',
        selectedPaths: [],
        selectionKind: 'empty'
      })
    ).toBe(false)
    expect(
      scriptMatchesMenu(script({ scopes: ['global'], contextMenuEnabled: true }), {
        folderPath: 'D:\\lib',
        selectedPaths: ['D:\\lib\\a.jpg'],
        selectionKind: 'file'
      })
    ).toBe(false)
  })

  it('groups optional categories', () => {
    const groups = groupScriptsByCategory([
      { name: 'B', category: 'Photos' },
      { name: 'A', category: 'Photos' },
      { name: 'Z', category: '' }
    ])
    expect(groups[0]?.category).toBe('Photos')
    expect(groups[0]?.items.map((i) => i.name)).toEqual(['A', 'B'])
    expect(groups[1]?.category).toBe('')
  })
})
