import { describe, expect, it } from 'vitest'
import { defaultSettings, settingsSchema } from '../shared/schemas/settings'
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
      propertiesBounds: { x: 20, y: 24, width: 520, height: 560 },
      propertiesWindowBounds: { x: 21, y: 25, width: 520, height: 560, maximized: false },
      usnManagerBounds: { x: 0, y: 1, width: 860, height: 640 },
      adsManagerBounds: { x: 1, y: 2, width: 800, height: 600 },
      powerRenameBounds: { x: 3, y: 4, width: 900, height: 700, maximized: true },
      remoteConnectionBounds: { x: 7, y: 8, width: 640, height: 520, maximized: false },
      compiledListsWindowBounds: { x: 5, y: 6, width: 640, height: 480 },
      previewWindowBounds: { x: 9, y: 10, width: 480, height: 720, maximized: true },
      scriptManagerBounds: { x: 11, y: 12, width: 800, height: 600, maximized: false },
      scriptGenerateBounds: { x: 13, y: 14, width: 720, height: 520, maximized: false },
      scriptRunnerBounds: { x: 15, y: 16, width: 760, height: 640 }
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

  it('round-trips compiledListUpdateFolders via full settingsSchema', () => {
    const folders = ['e:\\lists\\cat-a', 'e:\\lists\\cat-b']
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        slideshow: {
          ...defaultSettings.slideshow,
          compiledListUpdateFolders: folders
        }
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.slideshow.compiledListUpdateFolders).toEqual(folders)
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

  it('round-trips adsFieldColumns via full settingsSchema', () => {
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        adsFieldColumns: [
          { stream: 'AUTOV2', label: 'AutoV2 hash' },
          { stream: 'Caption' }
        ],
        detailsColumns: [
          ...defaultSettings.detailsColumns,
          { id: 'adsField:AUTOV2', width: 140 }
        ]
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.adsFieldColumns).toEqual([
      { stream: 'AUTOV2', label: 'AutoV2 hash' },
      { stream: 'Caption' }
    ])
    expect(parsed.settings.detailsColumns.some((c) => c.id === 'adsField:AUTOV2')).toBe(true)
  })

  it('defaults quickLaunch when the key is omitted', () => {
    const { quickLaunch: _omit, ...rest } = defaultSettings
    expect(settingsSchema.parse(rest).quickLaunch).toEqual([])
  })

  it('round-trips quickLaunch via full settingsSchema (D63)', () => {
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        quickLaunch: [
          {
            id: 'ql_ps1_abcd',
            name: 'Photoshop',
            path: '%ProgramFiles%\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe',
            args: '',
            show: 'icon',
            iconSizePx: 24,
            iconKind: 'shell',
            lucideColor: '#60a5fa'
          }
        ]
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.quickLaunch).toEqual([
      {
        id: 'ql_ps1_abcd',
        name: 'Photoshop',
        path: '%ProgramFiles%\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe',
        args: '',
        show: 'icon',
        iconSizePx: 24,
        iconKind: 'shell',
        lucideColor: '#60a5fa'
      }
    ])
  })

  it('round-trips Quick Launch Lucide + label (D63 / D45)', () => {
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        quickLaunch: [
          {
            id: 'ql_code_abcd',
            name: 'Code',
            path: '%LocalAppData%\\Programs\\Microsoft VS Code\\Code.exe',
            args: '',
            show: 'both',
            iconSizePx: 32,
            iconKind: 'lucide',
            lucideName: 'Code',
            lucideColor: '#34d399'
          }
        ]
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.quickLaunch[0]).toMatchObject({
      show: 'both',
      iconSizePx: 32,
      iconKind: 'lucide',
      lucideName: 'Code',
      lucideColor: '#34d399'
    })
  })

  it('round-trips viewPresets via full settingsSchema (D60)', () => {
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        viewPresets: [
          {
            id: 'vp_dev1_abcd',
            name: 'Development',
            viewMode: 'details',
            sort: { key: 'name', dir: 'asc' },
            detailsColumns: [{ id: 'size', width: 90 }],
            detailsNameWidth: 320,
            foldersFirst: true
          }
        ]
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.viewPresets[0]?.name).toBe('Development')
    expect(parsed.settings.viewPresets[0]?.viewMode).toBe('details')
  })

  it('round-trips grouped quickAccess via full settingsSchema (D58)', () => {
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        quickAccess: [
          'desktop',
          {
            kind: 'group',
            id: 'qag_work1_abcd',
            name: 'Work',
            color: '#60a5fa',
            collapsed: true,
            items: ['D:\\Projects']
          }
        ]
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.quickAccess).toEqual([
      'desktop',
      {
        kind: 'group',
        id: 'qag_work1_abcd',
        name: 'Work',
        color: '#60a5fa',
        collapsed: true,
        items: ['D:\\Projects']
      }
    ])
  })

  it('round-trips templates via full settingsSchema (D57)', () => {
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        templates: [
          {
            id: 'tpl_abc1_xyz2',
            name: 'Markdown Article',
            suggestedStem: 'Article',
            inputName: 'article_draft.md',
            sourceFile: 'tpl_abc1_xyz2.md'
          }
        ]
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.templates).toEqual([
      {
        id: 'tpl_abc1_xyz2',
        name: 'Markdown Article',
        suggestedStem: 'Markdown Article',
        inputName: 'article_draft.md',
        sourceFile: 'tpl_abc1_xyz2.md'
      }
    ])
  })

  it('round-trips pasteNonFileClipboard via full settingsSchema (D56)', () => {
    const doc = buildSettingsExportDocument({
      settings: { ...defaultSettings, pasteNonFileClipboard: false },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.pasteNonFileClipboard).toBe(false)
  })

  it('round-trips commandLineShell via full settingsSchema', () => {
    const doc = buildSettingsExportDocument({
      settings: { ...defaultSettings, commandLineShell: 'powershell' },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.commandLineShell).toBe('powershell')
  })

  it('round-trips folderStatsTreemapMaxLeaves via full settingsSchema', () => {
    const doc = buildSettingsExportDocument({
      settings: { ...defaultSettings, folderStatsTreemapMaxLeaves: 500 },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.folderStatsTreemapMaxLeaves).toBe(500)
  })

  it('round-trips showFolderStatistics via full settingsSchema', () => {
    const doc = buildSettingsExportDocument({
      settings: { ...defaultSettings, showFolderStatistics: false },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.showFolderStatistics).toBe(false)
  })

  it('round-trips virtualFolderOsProjectionEnabled via full settingsSchema (D68)', () => {
    expect(defaultSettings.virtualFolderOsProjectionEnabled).toBe(false)
    const doc = buildSettingsExportDocument({
      settings: { ...defaultSettings, virtualFolderOsProjectionEnabled: true },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.virtualFolderOsProjectionEnabled).toBe(true)
  })

  it('round-trips folderStatsSkipPaths via full settingsSchema', () => {
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        folderStatsSkipPaths: ['D:\\envs\\conda-meta', 'd:/envs/conda-meta/']
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.folderStatsSkipPaths).toEqual(['D:\\envs\\conda-meta'])
  })

  it('round-trips tabEqualWidth via full settingsSchema', () => {
    const doc = buildSettingsExportDocument({
      settings: { ...defaultSettings, tabEqualWidth: true },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.tabEqualWidth).toBe(true)
  })

  it('round-trips showTabIcons via full settingsSchema', () => {
    const doc = buildSettingsExportDocument({
      settings: { ...defaultSettings, showTabIcons: false },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.showTabIcons).toBe(false)
  })

  it('defaults treePinToggle on and round-trips off', () => {
    expect(defaultSettings.treePinToggle).toBe(true)
    const { treePinToggle: _omit, ...rest } = defaultSettings
    expect(settingsSchema.parse(rest).treePinToggle).toBe(true)
    const doc = buildSettingsExportDocument({
      settings: { ...defaultSettings, treePinToggle: false },
      networkHosts: []
    })
    expect(parseSettingsImport(doc).settings.treePinToggle).toBe(false)
  })

  it('defaults recycleBinPlacement to both and round-trips tree-only', () => {
    expect(defaultSettings.recycleBinPlacement).toBe('both')
    const { recycleBinPlacement: _omit, ...rest } = defaultSettings
    expect(settingsSchema.parse(rest).recycleBinPlacement).toBe('both')
    const doc = buildSettingsExportDocument({
      settings: { ...defaultSettings, recycleBinPlacement: 'tree' },
      networkHosts: []
    })
    expect(parseSettingsImport(doc).settings.recycleBinPlacement).toBe('tree')
  })

  it('migrates legacy showRecycleBinInTree to recycleBinPlacement', () => {
    expect(
      settingsSchema.parse({ version: 1, showRecycleBinInTree: false } as Record<string, unknown>)
        .recycleBinPlacement
    ).toBe('toolbar')
    expect(
      settingsSchema.parse({ version: 1, showRecycleBinInTree: true } as Record<string, unknown>)
        .recycleBinPlacement
    ).toBe('both')
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

  it('round-trips settings.ai (no keys) via full settingsSchema', () => {
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        ai: {
          ...defaultSettings.ai,
          enabled: true,
          defaultModel: 'gpt-4.1-mini',
          preferredScriptLanguage: 'python',
          providers: [
            {
              id: 'aip_test',
              name: 'LM Studio',
              type: 'lmstudio',
              baseUrl: 'http://127.0.0.1:1234/v1',
              model: 'local',
              local: true,
              timeoutSec: 45,
              cachedModels: ['local', 'other']
            }
          ]
        }
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.scripts.enabled).toBe(false)
    expect(parsed.settings.ai.enabled).toBe(true)
    expect(parsed.settings.ai.defaultModel).toBe('gpt-4.1-mini')
    expect(parsed.settings.ai.providers[0]?.baseUrl).toContain('127.0.0.1')
    expect(parsed.settings.ai.providers[0]?.cachedModels).toEqual(['local', 'other'])
    expect(parsed.settings.ai.providers[0]).not.toHaveProperty('apiKey')
    expect(JSON.stringify(parsed.settings.ai)).not.toMatch(/sk-/)
    expect(parsed.settings.scriptManagerBounds).toBeNull()
    expect(parsed.settings.scriptGenerateBounds).toBeNull()
    expect(parsed.settings.scriptRunnerBounds).toBeNull()
  })

  it('round-trips mediaMetadata nested prefs via full settingsSchema', () => {
    const doc = buildSettingsExportDocument({
      settings: {
        ...defaultSettings,
        mediaMetadata: {
          ...defaultSettings.mediaMetadata,
          enabled: true,
          tmdbApiKey: 'tmdb-test',
          omdbApiKey: 'omdb-test',
          internetSource: 'omdb',
          plexUrl: 'http://127.0.0.1:32400',
          coverHeightPx: 160,
          showEpisodeIconLabels: false,
          mixFilesAndFolders: false
        }
      },
      networkHosts: []
    })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.mediaMetadata.enabled).toBe(true)
    expect(parsed.settings.mediaMetadata.tmdbApiKey).toBe('tmdb-test')
    expect(parsed.settings.mediaMetadata.omdbApiKey).toBe('omdb-test')
    expect(parsed.settings.mediaMetadata.internetSource).toBe('omdb')
    expect(parsed.settings.mediaMetadata.coverHeightPx).toBe(160)
    expect(parsed.settings.mediaMetadata.showEpisodeIconLabels).toBe(false)
    expect(parsed.settings.mediaMetadata.mixFilesAndFolders).toBe(false)
    expect(defaultSettings.mediaMetadata.showEpisodeIconLabels).toBe(true)
    expect(defaultSettings.mediaMetadata.mixFilesAndFolders).toBe(false)
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
