/**
 * Portable settings backup / restore (D45).
 *
 * Export includes the full `settingsSchema` document (via `settingsForPortableExport`)
 * plus optional `networkHosts` and `remoteConnections`. **Any new preference must live
 * on `settingsSchema` (or a nested object already under it)** so it round-trips
 * automatically — do not invent a parallel export allowlist. Only window/dialog
 * geometry is stripped (`WINDOW_LIKE_KEYS`). Main `window-state.json` / live
 * `session.json` stay out. Remote passwords never leave the machine (`safeStorage`).
 */
import { z } from 'zod'
import { networkHostSchema, type NetworkHost } from './network'
import { remoteConnectionSchema, type RemoteConnection } from './remoteConnections'
import { scriptDefinitionSchema } from './scripts'
import { defaultSettings, settingsSchema, type Settings } from './settings'

export const SETTINGS_EXPORT_FORMAT = 'myfileexplorer-settings' as const
export const SETTINGS_EXPORT_FORMAT_VERSION = 1 as const

/** Dialog / floating-window geometry — not transferred between machines. */
const WINDOW_LIKE_KEYS = [
  'adsManagerBounds',
  'powerRenameBounds',
  'remoteConnectionBounds',
  'compiledListsWindowBounds',
  'previewWindowBounds',
  'scriptManagerBounds',
  'scriptGenerateBounds'
] as const

/**
 * Settings suitable for backup / another PC: full prefs (theme, layouts, …)
 * with dialog geometry cleared. Main window state lives in `window-state.json`
 * and is never part of this document.
 */
export function settingsForPortableExport(settings: Settings): Settings {
  return settingsSchema.parse({
    ...settings,
    adsManagerBounds: null,
    powerRenameBounds: null,
    remoteConnectionBounds: null,
    compiledListsWindowBounds: null,
    previewWindowBounds: null,
    scriptManagerBounds: null,
    scriptGenerateBounds: null
  })
}

export const scriptExportBundleSchema = z.object({
  id: z.string(),
  script: scriptDefinitionSchema,
  source: z.string()
})

export type ScriptExportBundle = z.infer<typeof scriptExportBundleSchema>

/** Strip password flags for portable export (secrets stay in safeStorage). */
export function remoteConnectionsForPortableExport(
  connections: RemoteConnection[]
): RemoteConnection[] {
  return connections.map((c) =>
    remoteConnectionSchema.parse({
      ...c,
      hasPassword: false
    })
  )
}

export const settingsExportDocumentSchema = z.object({
  format: z.literal(SETTINGS_EXPORT_FORMAT),
  formatVersion: z.literal(SETTINGS_EXPORT_FORMAT_VERSION).or(z.number().int().positive()),
  exportedAt: z.string().optional(),
  appVersion: z.string().optional(),
  settings: z.unknown(),
  /** When present (including `[]`), replace remembered LAN hosts on import. */
  networkHosts: z.array(networkHostSchema).optional(),
  /** When present (including `[]`), replace remote connection metadata on import (no passwords). */
  remoteConnections: z.array(remoteConnectionSchema).optional(),
  /** When present (including `[]`), replace the script library (source yes, no API keys). */
  scripts: z.array(scriptExportBundleSchema).optional()
})

export type SettingsExportDocument = {
  format: typeof SETTINGS_EXPORT_FORMAT
  formatVersion: typeof SETTINGS_EXPORT_FORMAT_VERSION
  exportedAt: string
  appVersion?: string
  settings: Settings
  networkHosts: NetworkHost[]
  remoteConnections: RemoteConnection[]
  scripts: ScriptExportBundle[]
}

export function buildSettingsExportDocument(input: {
  settings: Settings
  networkHosts: NetworkHost[]
  remoteConnections?: RemoteConnection[]
  scripts?: ScriptExportBundle[]
  appVersion?: string
}): SettingsExportDocument {
  return {
    format: SETTINGS_EXPORT_FORMAT,
    formatVersion: SETTINGS_EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    ...(input.appVersion ? { appVersion: input.appVersion } : {}),
    settings: settingsForPortableExport(input.settings),
    networkHosts: input.networkHosts,
    remoteConnections: remoteConnectionsForPortableExport(input.remoteConnections ?? []),
    scripts: input.scripts ?? []
  }
}

export type ParsedSettingsImport = {
  settings: Settings
  /** `null` = leave `network-hosts.json` unchanged (bare settings.json import). */
  networkHosts: NetworkHost[] | null
  /** `null` = leave `remote-connections.json` unchanged (bare settings.json import). */
  remoteConnections: RemoteConnection[] | null
  /** `null` = leave `scripts/library.json` unchanged (bare settings.json import). */
  scripts: ScriptExportBundle[] | null
  source: 'envelope' | 'settings-json'
}

function looksLikeSettingsObject(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const o = raw as Record<string, unknown>
  return 'theme' in o || 'layouts' in o || 'customTheme' in o || 'slideshow' in o
}

/**
 * Parse an export envelope or a raw `settings.json` body.
 * Always clears window-like dialog bounds on the resulting settings.
 */
export function parseSettingsImport(raw: unknown): ParsedSettingsImport {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    if (o.format === SETTINGS_EXPORT_FORMAT) {
      const env = settingsExportDocumentSchema.parse(raw)
      if (env.formatVersion > SETTINGS_EXPORT_FORMAT_VERSION) {
        throw new Error(
          `Settings file format version ${env.formatVersion} is newer than this app supports (${SETTINGS_EXPORT_FORMAT_VERSION})`
        )
      }
      return {
        settings: settingsForPortableExport(
          settingsSchema.parse({ ...defaultSettings, ...(env.settings as object) })
        ),
        networkHosts: Object.prototype.hasOwnProperty.call(o, 'networkHosts')
          ? (env.networkHosts ?? [])
          : null,
        remoteConnections: Object.prototype.hasOwnProperty.call(o, 'remoteConnections')
          ? remoteConnectionsForPortableExport(env.remoteConnections ?? [])
          : null,
        scripts: Object.prototype.hasOwnProperty.call(o, 'scripts') ? (env.scripts ?? []) : null,
        source: 'envelope'
      }
    }
  }

  if (!looksLikeSettingsObject(raw)) {
    throw new Error('Not a MyFileExplorer settings file')
  }

  return {
    settings: settingsForPortableExport(
      settingsSchema.parse({ ...defaultSettings, ...(raw as object) })
    ),
    networkHosts: null,
    remoteConnections: null,
    scripts: null,
    source: 'settings-json'
  }
}

/** Test helper — keys we strip for portability. */
export function windowLikeSettingsKeys(): readonly string[] {
  return WINDOW_LIKE_KEYS
}
