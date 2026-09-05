import { describe, expect, it } from 'vitest'
import {
  coerceIconNameForPack,
  filterPackIcons,
  isValidTabIcon,
  packIconNames,
  resolvePackIcon
} from '../renderer/lib/iconPacks'
import { lucideTabIconSchema } from '../shared/schemas/session'
import { parseItemIcon } from '../shared/schemas/itemAds'
import { sanitizeQuickLaunch } from '../shared/schemas/quickLaunch'
import { sanitizeScriptToolbar, defaultScriptDefinition } from '../shared/schemas/scripts'
import { tabIconPack } from '../shared/tabIcons'

describe('iconPacks registry', () => {
  it('every pack has a non-empty name list', () => {
    expect(packIconNames('lucide').length).toBeGreaterThan(100)
    expect(packIconNames('phosphor').length).toBeGreaterThan(100)
    expect(packIconNames('tabler').length).toBeGreaterThan(100)
  })

  it('resolves known Lucide names and rejects unknown', () => {
    expect(resolvePackIcon('lucide', 'Folder')).not.toBeNull()
    expect(resolvePackIcon('lucide', 'FolderOpen')).not.toBeNull()
    expect(resolvePackIcon('lucide', 'DefinitelyNotAnIcon_xyz')).toBeNull()
  })

  it('resolves Phosphor Regular exports by PascalCase name', () => {
    expect(resolvePackIcon('phosphor', 'Folder')).not.toBeNull()
    expect(resolvePackIcon('phosphor', 'FolderOpen')).not.toBeNull()
    expect(resolvePackIcon('phosphor', 'DefinitelyNotAnIcon_xyz')).toBeNull()
  })

  it('stores Tabler names without Icon prefix and maps to IconFolder', () => {
    expect(resolvePackIcon('tabler', 'Folder')).not.toBeNull()
    expect(resolvePackIcon('tabler', 'IconFolder')).toBeNull()
  })

  it('filters case-insensitively', () => {
    const hits = filterPackIcons('lucide', 'folder open')
    expect(hits.some((n) => n === 'FolderOpen' || n.toLowerCase().includes('folder'))).toBe(true)
    expect(filterPackIcons('tabler', 'FOLDER').some((n) => n.toLowerCase().includes('folder'))).toBe(
      true
    )
  })

  it('coerceIconNameForPack keeps valid names and resets invalid on pack switch', () => {
    expect(coerceIconNameForPack('lucide', 'Folder')).toBe('Folder')
    // Phosphor-only style name unlikely on Lucide — if present keep, else Folder
    const coerced = coerceIconNameForPack('lucide', 'NotARealIconName_zzz')
    expect(coerced === 'Folder' || resolvePackIcon('lucide', coerced)).toBeTruthy()
    expect(resolvePackIcon('lucide', coerced)).not.toBeNull()
  })

  it('legacy Lucide tab icon without pack is valid', () => {
    expect(isValidTabIcon({ name: 'Folder', color: '#fbbf24' })).toBe(true)
    expect(tabIconPack({ name: 'Folder', color: '#fbbf24' })).toBe('lucide')
  })
})

describe('multi-pack schemas (backward compatible)', () => {
  it('parses old tab Lucide JSON without pack', () => {
    const parsed = lucideTabIconSchema.parse({ name: 'Monitor', color: '#60a5fa' })
    expect(parsed.name).toBe('Monitor')
    expect(parsed.pack).toBeUndefined()
  })

  it('round-trips tab pack phosphor / tabler', () => {
    expect(lucideTabIconSchema.parse({ name: 'Folder', color: '#fbbf24', pack: 'phosphor' }).pack).toBe(
      'phosphor'
    )
    expect(lucideTabIconSchema.parse({ name: 'Folder', color: '#fbbf24', pack: 'tabler' }).pack).toBe(
      'tabler'
    )
  })

  it('junk pack does not crash tab icon parse', () => {
    const parsed = lucideTabIconSchema.parse({ name: 'Folder', color: '#fbbf24', pack: 'nope' })
    expect(parsed.pack).toBeUndefined()
    expect(parsed.name).toBe('Folder')
  })

  it('parses old item lucide ADS without pack; accepts phosphor pack', () => {
    expect(parseItemIcon(JSON.stringify({ kind: 'lucide', name: 'Star', color: '#60a5fa' }))).toEqual({
      kind: 'lucide',
      name: 'Star',
      color: '#60a5fa'
    })
    expect(
      parseItemIcon(
        JSON.stringify({ kind: 'lucide', name: 'Star', color: '#60a5fa', pack: 'phosphor' })
      )
    ).toMatchObject({ kind: 'lucide', name: 'Star', pack: 'phosphor' })
    expect(
      parseItemIcon(JSON.stringify({ kind: 'lucide', name: 'Star', color: '#60a5fa', pack: 'junk' }))
    ).toMatchObject({ kind: 'lucide', name: 'Star' })
  })

  it('sanitize Quick Launch keeps empty lucide → shell; phosphor empty name → shell', () => {
    expect(
      sanitizeQuickLaunch([
        {
          id: 'ql_test_abcd',
          name: 'X',
          path: 'C:\\x.exe',
          iconKind: 'lucide',
          lucideColor: '#60a5fa'
        }
      ])[0]?.iconKind
    ).toBe('shell')
    expect(
      sanitizeQuickLaunch([
        {
          id: 'ql_test_efgh',
          name: 'Y',
          path: 'C:\\y.exe',
          iconKind: 'lucide',
          lucidePack: 'phosphor',
          lucideColor: '#60a5fa'
        }
      ])[0]?.iconKind
    ).toBe('shell')
  })

  it('sanitize Quick Launch preserves lucidePack when name present', () => {
    const next = sanitizeQuickLaunch([
      {
        id: 'ql_tabler_01',
        name: 'App',
        path: 'C:\\app.exe',
        iconKind: 'lucide',
        lucideName: 'Folder',
        lucidePack: 'tabler',
        lucideColor: '#60a5fa'
      }
    ])
    expect(next[0]).toMatchObject({
      iconKind: 'lucide',
      lucideName: 'Folder',
      lucidePack: 'tabler'
    })
  })

  it('script toolbar sanitize unchanged for custom-without-id', () => {
    const next = sanitizeScriptToolbar({
      ...defaultScriptDefinition(),
      id: 'scr_test',
      createdAt: '',
      updatedAt: '',
      iconKind: 'custom',
      lucideName: 'Zap'
    })
    expect(next.iconKind).toBe('lucide')
    expect(next.lucideName).toBe('Zap')
  })
})
