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
      remoteConnectionBounds: { x: 7, y: 8, width: 640, height: 520, maximized: false },
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

  it('round-trips remoteRepos.enabled via full settingsSchema', () => {
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        remoteRepos: { enabled: true }
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.remoteRepos).toEqual({ enabled: true })
  })

  it('round-trips remote connection metadata and strips hasPassword', () => {
    const doc = buildSettingsExportDocument({
      settings: { ...defaultSettings, remoteRepos: { enabled: true } },
      networkHosts: [],
      remoteConnections: [
        {
          id: 'conn-1',
          name: 'Rebex',
          protocol: 'sftp',
          host: 'test.rebex.net',
          port: 22,
          username: 'demo',
          startPath: '/',
          insecureFtpAck: false,
          hostFingerprint: 'abc',
          hasPassword: true,
          updatedAt: 1
        }
      ]
    })
    expect(doc.remoteConnections[0]?.hasPassword).toBe(false)
    const parsed = parseSettingsImport(doc)
    expect(parsed.remoteConnections).toHaveLength(1)
    expect(parsed.remoteConnections?.[0]).toMatchObject({
      id: 'conn-1',
      name: 'Rebex',
      protocol: 'sftp',
      host: 'test.rebex.net',
      hasPassword: false
    })
  })

  it('accepts bare settings.json and leaves network hosts / remotes unchanged', () => {
    const parsed = parseSettingsImport({
      ...defaultSettings,
      theme: 'light',
      fontSizePx: 16
    })
    expect(parsed.source).toBe('settings-json')
    expect(parsed.settings.theme).toBe('light')
    expect(parsed.settings.fontSizePx).toBe(16)
    expect(parsed.networkHosts).toBeNull()
    expect(parsed.remoteConnections).toBeNull()
  })

  it('rejects unknown documents', () => {
    expect(() => parseSettingsImport({ format: 'other', settings: {} })).toThrow()
    expect(() => parseSettingsImport({ hello: true })).toThrow(/Not a MyFileExplorer/)
  })

  it('round-trips full context menu customization (D41) via settingsSchema', () => {
    const verb = {
      id: 'sv-acdsee',
      label: 'Browse with ACDSee',
      verbKey: 'BrowseWithACDSee',
      registryKey: 'HKCR\\Directory\\shell\\BrowseWithACDSee',
      targetKind: 'folders' as const,
      targetHint: 'Directory',
      commandPreview: '"C:\\Program Files\\ACD Systems\\ACDSee\\ACDSee.exe" "%1"',
      executable: 'C:\\Program Files\\ACD Systems\\ACDSee\\ACDSee.exe',
      argsTemplate: '{path}',
      extensions: null,
      supported: true,
      advanced: false
    }
    const contextMenu = {
      files: [
        {
          id: 'cmc_ps',
          label: 'Edit in Photoshop',
          enabled: true,
          executable: '%ProgramFiles%\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe',
          argsTemplate: '{path}',
          match: { type: 'extensions' as const, extensions: ['psd', 'png'] }
        }
      ],
      folders: [
        {
          id: 'cmc_code',
          label: 'Open in VS Code',
          enabled: true,
          executable: '%LocalAppData%\\Programs\\Microsoft VS Code\\Code.exe',
          argsTemplate: '{path}',
          match: { type: 'all' as const }
        }
      ],
      hiddenBuiltins: ['power-rename', 'alternate-streams'] as const,
      builtinLayout: [
        { type: 'item' as const, id: 'open' as const },
        { type: 'discovered' as const, id: 'sv-acdsee' },
        { type: 'sep' as const, id: 'sep-export-1' },
        { type: 'item' as const, id: 'properties' as const }
      ],
      discovered: {
        verbs: [verb],
        scannedKeys: 42,
        enabledIds: ['sv-acdsee']
      }
    }
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        contextMenu: {
          ...defaultSettings.contextMenu,
          ...contextMenu,
          hiddenBuiltins: [...contextMenu.hiddenBuiltins]
        }
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    const cm = parsed.settings.contextMenu
    expect(cm.files).toEqual(contextMenu.files)
    expect(cm.folders).toEqual(contextMenu.folders)
    expect(cm.hiddenBuiltins).toEqual(['power-rename', 'alternate-streams'])
    expect(cm.discovered).toEqual(contextMenu.discovered)
    expect(cm.builtinLayout[0]).toEqual({ type: 'item', id: 'open' })
    expect(cm.builtinLayout[1]).toEqual({ type: 'discovered', id: 'sv-acdsee' })
    expect(cm.builtinLayout[2]).toEqual({ type: 'sep', id: 'sep-export-1' })
    expect(cm.builtinLayout.some((e) => e.type === 'item' && e.id === 'copy')).toBe(true)
  })

  it('round-trips contextMenu.builtinLayout via full settingsSchema', () => {
    const layout = [
      { type: 'item' as const, id: 'properties' as const },
      { type: 'sep' as const, id: 'my-sep' },
      { type: 'item' as const, id: 'open' as const }
    ]
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        contextMenu: {
          ...defaultSettings.contextMenu,
          builtinLayout: layout
        }
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    const ids = parsed.settings.contextMenu.builtinLayout
      .filter((e) => e.type === 'item')
      .map((e) => e.id)
    expect(parsed.settings.contextMenu.builtinLayout[0]).toEqual({ type: 'sep', id: 'my-sep' })
    expect(parsed.settings.contextMenu.builtinLayout[1]).toEqual({ type: 'item', id: 'open' })
    expect(ids[ids.length - 1]).toBe('properties')
    expect(ids).toContain('open')
    expect(ids).toContain('copy')
  })
})
