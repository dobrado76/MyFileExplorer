import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../shared/schemas/settings'
import {
  SETTINGS_EXPORT_FORMAT,
  buildSettingsExportDocument,
  parseSettingsImport,
  settingsForPortableExport,
  windowLikeSettingsKeys
} from '../shared/schemas/settingsExport'

describe('settings export / import', () => {
  it('strips dialog window geometry for portable export', () => {
    const withBounds = {
      ...defaultSettings,
      theme: 'light' as const,
      adsManagerBounds: { x: 1, y: 2, width: 800, height: 600 },
      powerRenameBounds: { x: 3, y: 4, width: 900, height: 700, maximized: true },
      compiledListsWindowBounds: { x: 5, y: 6, width: 640, height: 480 }
    }
    const portable = settingsForPortableExport(withBounds)
    for (const key of windowLikeSettingsKeys()) {
      expect(portable[key as keyof typeof portable]).toBeNull()
    }
    expect(portable.theme).toBe('light')
  })

  it('round-trips envelope with network hosts', () => {
    const doc = buildSettingsExportDocument({
      settings: { ...defaultSettings, theme: 'custom' },
      networkHosts: [{ name: 'NEWONYX', unc: '\\\\NEWONYX' }],
      appVersion: '0.9.0'
    })
    expect(doc.format).toBe(SETTINGS_EXPORT_FORMAT)
    expect(doc.settings.adsManagerBounds).toBeNull()

    const parsed = parseSettingsImport(doc)
    expect(parsed.source).toBe('envelope')
    expect(parsed.settings.theme).toBe('custom')
    expect(parsed.networkHosts).toEqual([{ name: 'NEWONYX', unc: '\\\\NEWONYX' }])
  })

  it('round-trips new nested prefs (showLocalComputer) via full settingsSchema', () => {
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        networkDiscovery: {
          ...defaultSettings.networkDiscovery,
          enabled: false,
          showLocalComputer: true,
          mode: 'manual',
          intervalMinutes: 10
        }
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.networkDiscovery).toEqual({
      enabled: false,
      mode: 'manual',
      intervalMinutes: 10,
      showLocalComputer: true
    })
  })

  it('accepts bare settings.json and leaves network hosts unchanged', () => {
    const parsed = parseSettingsImport({
      ...defaultSettings,
      theme: 'light',
      fontSizePx: 16
    })
    expect(parsed.source).toBe('settings-json')
    expect(parsed.settings.theme).toBe('light')
    expect(parsed.settings.fontSizePx).toBe(16)
    expect(parsed.networkHosts).toBeNull()
  })

  it('rejects unknown documents', () => {
    expect(() => parseSettingsImport({ format: 'other', settings: {} })).toThrow()
    expect(() => parseSettingsImport({ hello: true })).toThrow(/Not a MyFileExplorer/)
  })
})
