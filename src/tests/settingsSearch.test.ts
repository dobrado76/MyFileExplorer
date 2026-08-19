import { describe, expect, it } from 'vitest'
import {
  SETTINGS_NAV,
  filterSettingsNav,
  pickSettingsSectionForSearch,
  sectionMatchesSettingsSearch,
  settingsSearchTokens,
  textMatchesSettingsSearch
} from '../shared/settingsSearch'

describe('settings search', () => {
  it('tokenizes on spaces and punctuation', () => {
    expect(settingsSearchTokens('  Theme, dark  ')).toEqual(['theme', 'dark'])
    expect(settingsSearchTokens('python|3')).toEqual(['python', '3'])
    expect(settingsSearchTokens('')).toEqual([])
  })

  it('requires every token to appear', () => {
    expect(textMatchesSettingsSearch('Enable scripting Python 3', ['python'])).toBe(true)
    expect(textMatchesSettingsSearch('Enable scripting Python 3', ['python', 'enable'])).toBe(true)
    expect(textMatchesSettingsSearch('Enable scripting Python 3', ['python', 'tmdb'])).toBe(false)
  })

  it('matches a section via label or keywords', () => {
    const ai = SETTINGS_NAV.find((s) => s.id === 'ai')
    const appearance = SETTINGS_NAV.find((s) => s.id === 'appearance')
    expect(ai && sectionMatchesSettingsSearch(ai, settingsSearchTokens('python'))).toBe(true)
    expect(ai && sectionMatchesSettingsSearch(ai, settingsSearchTokens('scripting'))).toBe(true)
    expect(appearance && sectionMatchesSettingsSearch(appearance, settingsSearchTokens('theme'))).toBe(
      true
    )
    expect(appearance && sectionMatchesSettingsSearch(appearance, settingsSearchTokens('python'))).toBe(
      false
    )
  })

  it('filters the nav and keeps the current section when it still matches', () => {
    const tokens = settingsSearchTokens('recycle')
    const visible = filterSettingsNav(SETTINGS_NAV, tokens)
    expect(visible.map((s) => s.id)).toEqual(['behavior'])
    expect(pickSettingsSectionForSearch('behavior', visible)).toBe('behavior')
    expect(pickSettingsSectionForSearch('appearance', visible)).toBe('behavior')
  })

  it('returns null when nothing matches', () => {
    const visible = filterSettingsNav(SETTINGS_NAV, settingsSearchTokens('zzzznotasetting'))
    expect(visible).toEqual([])
    expect(pickSettingsSectionForSearch('appearance', visible)).toBeNull()
  })

  it('empty query keeps every section', () => {
    expect(filterSettingsNav(SETTINGS_NAV, []).map((s) => s.id)).toEqual(
      SETTINGS_NAV.map((s) => s.id)
    )
  })
})
