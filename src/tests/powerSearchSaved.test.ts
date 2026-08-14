import { describe, expect, it } from 'vitest'
import {
  MAX_POWER_SEARCH_SAVED,
  powerSearchSavedSchema,
  powerSearchStateSchema
} from '../shared/schemas/search'
import { defaultSettings, settingsSchema } from '../shared/schemas/settings'
import { buildSearchQuery, defaultPowerSearchState, sanitizePowerSearchState } from '../shared/searchBuilder'
import { buildSettingsExportDocument, parseSettingsImport } from '../shared/schemas/settingsExport'

describe('powerSearchStateSchema', () => {
  it('fills missing builder fields', () => {
    const parsed = powerSearchStateSchema.parse({ terms: 'vacation', types: ['pic'] })
    expect(parsed.terms).toBe('vacation')
    expect(parsed.types).toEqual(['pic'])
    expect(parsed.itemKind).toBe('any')
    expect(parsed.excludeExtensions).toBe('')
  })
})

describe('sanitizePowerSearchState', () => {
  it('merges onto defaults and still builds a query', () => {
    const state = sanitizePowerSearchState({
      terms: 'cat',
      types: ['pic'],
      dateModified: 'thisweek',
      sizePreset: 'large'
    })
    expect(state.itemKind).toBe('any')
    expect(buildSearchQuery(state)).toBe('pic: cat size:large dm:thisweek')
  })

  it('falls back to defaults for garbage', () => {
    expect(sanitizePowerSearchState(null)).toEqual(defaultPowerSearchState())
  })
})

describe('powerSearchSaved settings', () => {
  it('round-trips named designs without a target folder', () => {
    const entry = powerSearchSavedSchema.parse({
      id: 'ps-1',
      name: 'Large PNGs this week',
      query: 'pic: ext:png size:large dm:thisweek',
      builder: {
        ...defaultPowerSearchState(),
        types: ['pic'],
        extensions: 'png',
        sizePreset: 'large',
        dateModified: 'thisweek'
      },
      matchPath: true,
      updatedAt: 1
    })
    expect(entry.matchCase).toBe(false)
    expect(entry.manualQuery).toBe(false)

    const doc = buildSettingsExportDocument({
      settings: { ...defaultSettings, powerSearchSaved: [entry] },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.powerSearchSaved).toHaveLength(1)
    expect(parsed.settings.powerSearchSaved[0]?.name).toBe('Large PNGs this week')
    expect(parsed.settings.powerSearchSaved[0]?.builder.extensions).toBe('png')
  })

  it('caps the saved list', () => {
    const many = Array.from({ length: MAX_POWER_SEARCH_SAVED + 5 }, (_, i) => ({
      id: `ps-${i}`,
      name: `S${i}`,
      query: 'a',
      builder: defaultPowerSearchState(),
      updatedAt: i
    }))
    const parsed = settingsSchema.parse({ powerSearchSaved: many })
    expect(parsed.powerSearchSaved).toHaveLength(MAX_POWER_SEARCH_SAVED)
  })
})
