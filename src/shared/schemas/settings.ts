import { z } from 'zod'
import { DETAILS_COLUMN_IDS, detailsColumnIdSchema, type DetailsColumnId } from './columns'
import { viewModeSchema, sortSchema } from './session'
import { MAX_FOLDER_VIEWS, type FolderView } from '../folderViews'
import { MAX_LAYOUTS, workspaceLayoutSchema, type WorkspaceLayout } from '../layouts'
import {
  DEFAULT_VID_THUMB_FRAME_MS,
  VID_THUMB_FRAME_MS_MAX,
  VID_THUMB_FRAME_MS_MIN
} from '../vidThumbCache'
import { normalizeHideNameExtensions } from '../hideNameExtensions'
import {
  MAX_POWER_SEARCH_SAVED,
  MAX_SEARCH_BOOKMARKS,
  MAX_SEARCH_FILTERS,
  powerSearchSavedSchema,
  searchBookmarkSchema,
  searchFilterSchema,
  type PowerSearchSaved,
  type SearchBookmark,
  type SearchFilter
} from './search'
import {
  defaultSlideshowSettings,
  slideshowSettingsSchema
} from './slideshow'
import {
  defaultNetworkDiscoverySettings,
  networkDiscoverySettingsSchema
} from './networkDiscovery'
import {
  defaultRemoteReposSettings,
  remoteReposSettingsSchema
} from './remoteRepos'
import {
  MAX_CONTEXT_MENU_COMMANDS,
  type ContextMenuCommand
} from '../contextMenuCommands'
import {
  DEFAULT_CONTEXT_MENU_BUILTIN_LAYOUT,
  sanitizeBuiltinLayout,
  sanitizeHiddenBuiltins,
  type ContextMenuBuiltinId,
  type ContextMenuBuiltinLayoutEntry
} from '../contextMenuBuiltins'
import {
  defaultContextMenuDiscoveredSettings,
  discoveredShellVerbSchema,
  sanitizeDiscoveredSettings,
  type ContextMenuDiscoveredSettings
} from './shellVerbs'
import { DEFAULT_UPDATES_SOURCE } from '../updatesSource'

/** Settings → Appearance font size (px). */
export const FONT_SIZE_PX_MIN = 9
export const FONT_SIZE_PX_MAX = 28
/** Settings → Appearance chrome / toolbar icon size (px). */
export const ICON_SIZE_PX_MIN = 12
export const ICON_SIZE_PX_MAX = 40

export type { DetailsColumnId } from './columns'
export type { FolderView } from '../folderViews'
export type { WorkspaceLayout } from '../layouts'
export type { SlideshowSettings, SlideshowOrder } from './slideshow'
export type {
  NetworkDiscoverySettings,
  NetworkDiscoveryMode
} from './networkDiscovery'
export type { ContextMenuCommand, ContextMenuCommandMatch } from '../contextMenuCommands'
export type { ContextMenuBuiltinId } from '../contextMenuBuiltins'
export {
  NETWORK_DISCOVERY_INTERVAL_MIN_MINUTES,
  NETWORK_DISCOVERY_INTERVAL_MAX_MINUTES,
  NETWORK_DISCOVERY_INTERVAL_DEFAULT_MINUTES,
  networkDiscoveryIntervalMs
} from './networkDiscovery'

export const themeModeSchema = z.enum(['dark', 'light', 'custom'])
export type ThemeMode = z.infer<typeof themeModeSchema>

export const customThemeSchema = z.object({
  bg: z.string().catch('#12141a'),
  bgElevated: z.string().catch('#1a1d26'),
  border: z.string().catch('#2a2f3a'),
  text: z.string().catch('#e8eaef'),
  textDim: z.string().catch('#9aa3b2'),
  accent: z.string().catch('#3b82f6')
})
export type CustomTheme = z.infer<typeof customThemeSchema>

export const defaultCustomTheme: CustomTheme = {
  bg: '#12141a',
  bgElevated: '#1a1d26',
  border: '#2a2f3a',
  text: '#e8eaef',
  textDim: '#9aa3b2',
  accent: '#3b82f6'
}

const detailsColumnEntrySchema = z.object({
  id: detailsColumnIdSchema,
  width: z.number().int().min(50).max(1200)
})

const defaultDetailsColumns = [
  { id: 'mtime' as const, width: 150 },
  { id: 'type' as const, width: 110 },
  { id: 'size' as const, width: 90 }
]

const allowedColumnIds = new Set<string>(DETAILS_COLUMN_IDS)

export const contextMenuCommandMatchSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({
    type: z.literal('extensions'),
    extensions: z.array(z.string()).max(64)
  })
])

export const contextMenuCommandSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  enabled: z.boolean(),
  executable: z.string().min(1).max(1024),
  argsTemplate: z.string().max(500),
  match: contextMenuCommandMatchSchema
})

function sanitizeContextMenuCommands(raw: unknown): ContextMenuCommand[] {
  if (!Array.isArray(raw)) return []
  const out: ContextMenuCommand[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const p = contextMenuCommandSchema.safeParse(item)
    if (!p.success || seen.has(p.data.id)) continue
    seen.add(p.data.id)
    out.push(p.data)
    if (out.length >= MAX_CONTEXT_MENU_COMMANDS) break
  }
  return out
}

const contextMenuBuiltinLayoutEntrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('item'), id: z.string() }),
  z.object({ type: z.literal('discovered'), id: z.string().min(1) }),
  z.object({ type: z.literal('sep'), id: z.string().min(1) })
])

export const contextMenuSettingsSchema = z.object({
  files: z.preprocess(
    sanitizeContextMenuCommands,
    z.array(contextMenuCommandSchema).max(MAX_CONTEXT_MENU_COMMANDS).catch([])
  ),
  folders: z.preprocess(
    sanitizeContextMenuCommands,
    z.array(contextMenuCommandSchema).max(MAX_CONTEXT_MENU_COMMANDS).catch([])
  ),
  /** Built-in verb ids the user turned off (missing ⇒ shown). */
  hiddenBuiltins: z.preprocess(sanitizeHiddenBuiltins, z.array(z.string()).catch([])),
  /** Order + separator grouping for built-ins / enabled Discover verbs. */
  builtinLayout: z.preprocess(
    sanitizeBuiltinLayout,
    z.array(contextMenuBuiltinLayoutEntrySchema).catch(DEFAULT_CONTEXT_MENU_BUILTIN_LAYOUT)
  ),
  /** Last Discover scan catalog + enabled verb ids (D41). */
  discovered: z.preprocess(
    sanitizeDiscoveredSettings,
    z
      .object({
        verbs: z.array(discoveredShellVerbSchema),
        scannedKeys: z.number().int().nonnegative(),
        enabledIds: z.array(z.string())
      })
      .catch(defaultContextMenuDiscoveredSettings)
  )
})

export type ContextMenuSettings = {
  files: ContextMenuCommand[]
  folders: ContextMenuCommand[]
  hiddenBuiltins: ContextMenuBuiltinId[]
  builtinLayout: ContextMenuBuiltinLayoutEntry[]
  discovered: ContextMenuDiscoveredSettings
}

export const defaultContextMenuSettings: ContextMenuSettings = {
  files: [],
  folders: [],
  hiddenBuiltins: [],
  builtinLayout: DEFAULT_CONTEXT_MENU_BUILTIN_LAYOUT,
  discovered: defaultContextMenuDiscoveredSettings
}

function sanitizeDetailsColumns(raw: unknown): { id: string; width: number }[] {
  if (!Array.isArray(raw)) return defaultDetailsColumns
  const seen = new Set<string>()
  const out: { id: string; width: number }[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const id = (item as { id?: unknown }).id
    const width = (item as { width?: unknown }).width
    // `folder` is search-results-only — never persist in folder/global column layout.
    if (id === 'folder') continue
    if (typeof id !== 'string' || !allowedColumnIds.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      width: typeof width === 'number' && Number.isFinite(width) ? width : 100
    })
  }
  return out.length > 0 ? out : defaultDetailsColumns
}

export const folderViewSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().catch(false),
  viewMode: viewModeSchema.catch('largeIcons'),
  sort: sortSchema.catch({ key: 'name', dir: 'asc' }),
  detailsColumns: z.preprocess(
    sanitizeDetailsColumns,
    z.array(detailsColumnEntrySchema).catch(defaultDetailsColumns)
  ),
  detailsNameWidth: z.number().int().min(120).max(1600).catch(320)
})

export const settingsSchema = z.object({
  version: z.literal(1).catch(1),
  theme: themeModeSchema.catch('dark'),
  customTheme: customThemeSchema.catch(defaultCustomTheme),
  fontFamily: z.string().catch('Segoe UI'),
  fontSizePx: z.number().min(FONT_SIZE_PX_MIN).max(FONT_SIZE_PX_MAX).catch(13),
  iconSizePx: z.number().min(ICON_SIZE_PX_MIN).max(ICON_SIZE_PX_MAX).catch(20),
  /**
   * When true, every tab is as wide as the widest label (then equal-shrink if the strip overflows).
   * When false, each tab is only as wide as its own label + icon (capped by --tab-max).
   */
  tabEqualWidth: z.boolean().catch(false),
  /** Paint Lucide icons on tabs. Assigned icons stay in the session when this is off. */
  showTabIcons: z.boolean().catch(true),
  foldersFirst: z.boolean().catch(true),
  /**
   * Explorer-style item checkboxes in the file view (toggle selection without Ctrl).
   * Off by default.
   */
  itemCheckboxes: z.boolean().catch(false),
  defaultNewTabPath: z.string().catch(''),
  confirmPermanentDeleteAlways: z.boolean().catch(false),
  previewVisibleDefault: z.boolean().catch(true),
  textPreviewMaxBytes: z.number().min(1024).catch(2 * 1024 * 1024),
  /** Delay between `!VIDTHUMB_CACHE` strip frames in icon views (ms). */
  vidThumbFrameMs: z
    .number()
    .int()
    .min(VID_THUMB_FRAME_MS_MIN)
    .max(VID_THUMB_FRAME_MS_MAX)
    .catch(DEFAULT_VID_THUMB_FRAME_MS),
  /** Auto-start preview `<video>` / `<audio>` when a media file is selected. */
  previewVideoAutoplay: z.boolean().catch(false),
  /**
   * Search / index exclude patterns (view-filter language): folder names, file
   * names, extensions (`.tmp` / `*.log`), wildcards, or absolute paths.
   */
  searchExcludeDirNames: z
    .array(z.string())
    .catch(['node_modules', '.git', '.hg', '.svn', 'Thumbs.db']),
  /** Toolbar “indexed” search scope — persist across sessions. */
  searchIndexedOnly: z.boolean().catch(false),
  /** Everything-style match toggles (D34). */
  searchMatchPath: z.boolean().catch(false),
  searchMatchCase: z.boolean().catch(false),
  searchWholeWord: z.boolean().catch(false),
  searchRegex: z.boolean().catch(false),
  searchFilters: z.preprocess((raw) => {
    if (!Array.isArray(raw)) return []
    const out: SearchFilter[] = []
    const seen = new Set<string>()
    for (const item of raw) {
      const p = searchFilterSchema.safeParse(item)
      if (!p.success || seen.has(p.data.id)) continue
      seen.add(p.data.id)
      out.push(p.data)
      if (out.length >= MAX_SEARCH_FILTERS) break
    }
    return out
  }, z.array(searchFilterSchema).catch([])),
  searchBookmarks: z.preprocess((raw) => {
    if (!Array.isArray(raw)) return []
    const out: SearchBookmark[] = []
    const seen = new Set<string>()
    for (const item of raw) {
      const p = searchBookmarkSchema.safeParse(item)
      if (!p.success || seen.has(p.data.id)) continue
      seen.add(p.data.id)
      out.push(p.data)
      if (out.length >= MAX_SEARCH_BOOKMARKS) break
    }
    return out
  }, z.array(searchBookmarkSchema).catch([])),
  /**
   * Named Power Search designs (builder + match flags + query).
   * Target (current folder vs indexed) is not stored — chosen when you run.
   */
  powerSearchSaved: z.preprocess((raw) => {
    if (!Array.isArray(raw)) return []
    const out: PowerSearchSaved[] = []
    const seen = new Set<string>()
    for (const item of raw) {
      const p = powerSearchSavedSchema.safeParse(item)
      if (!p.success || seen.has(p.data.id)) continue
      seen.add(p.data.id)
      out.push(p.data)
      if (out.length >= MAX_POWER_SEARCH_SAVED) break
    }
    return out
  }, z.array(powerSearchSavedSchema).catch([])),
  /** Optional localhost HTTP search API (D34 phase 6). */
  searchHttpEnabled: z.boolean().catch(false),
  searchHttpPort: z.number().int().min(1024).max(65535).catch(8081),
  searchHttpToken: z.string().catch(''),
  viewFilterEnabled: z.boolean().catch(true),
  viewFilterPatterns: z.array(z.string()).catch([]),
  /**
   * Extensions whose “.ext” is omitted from file-view / search labels (display only).
   * Values without a leading dot, e.g. `lnk`. Default includes `lnk`.
   */
  hideNameExtensions: z.preprocess((raw) => {
    if (raw === undefined || raw === null) return ['lnk']
    return normalizeHideNameExtensions(raw)
  }, z.array(z.string()).catch(['lnk'])),
  detailsNameWidth: z.number().int().min(120).max(1600).catch(320),
  detailsColumns: z.preprocess(
    sanitizeDetailsColumns,
    z.array(detailsColumnEntrySchema).catch(defaultDetailsColumns)
  ),
  /**
   * Per-folder view overrides (exact or recursive). Cap enforced on write.
   */
  folderViews: z.preprocess((raw) => {
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    const out: unknown[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const path = (item as { path?: unknown }).path
      if (typeof path !== 'string' || !path.trim()) continue
      const key = path.replace(/[\\/]+$/, '').toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
      if (out.length >= MAX_FOLDER_VIEWS) break
    }
    return out
  }, z.array(folderViewSchema).catch([])),
  /**
   * Named workspace layouts: tab set + per-tab view/sort/tree + chrome splitters.
   * Cap enforced on parse/write.
   */
  layouts: z.preprocess((raw) => {
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    const out: WorkspaceLayout[] = []
    for (const item of raw) {
      const parsed = workspaceLayoutSchema.safeParse(item)
      if (!parsed.success) continue
      if (seen.has(parsed.data.id)) continue
      seen.add(parsed.data.id)
      out.push(parsed.data)
      if (out.length >= MAX_LAYOUTS) break
    }
    return out
  }, z.array(workspaceLayoutSchema).catch([])),
  /**
   * Ordered Quick access: builtin ids (`desktop`, …) or absolute folder paths.
   * Empty = factory defaults (Desktop / Downloads / Documents / Pictures).
   */
  quickAccess: z.array(z.string()).catch([]),
  /** @deprecated Migrated into `quickAccess` on edit. */
  quickAccessPins: z.array(z.string()).catch([]),
  /** @deprecated Migrated into `quickAccess` on edit. */
  quickAccessHiddenDefaults: z.array(z.string()).catch([]),
  /** Local folder or GitHub Releases URL for installer updates. */
  updatesFolder: z.string().catch(DEFAULT_UPDATES_SOURCE),
  /**
   * Chromium GPU compositing off (Electron `app.disableHardwareAcceleration`).
   * Applied at process start — restart required after change. Frees VRAM when
   * sharing a GPU with training / other CUDA apps.
   */
  disableHardwareAcceleration: z.boolean().catch(false),
  /**
   * Master switch for slideshow **chrome** (toolbar + folder Start Slideshow).
   * Settings → Slideshow stays in the nav either way; turning off also stops
   * an active player.
   */
  slideshowFeaturesEnabled: z.boolean().catch(false),
  slideshow: z.preprocess((raw) => {
    if (!raw || typeof raw !== 'object') return defaultSlideshowSettings
    return { ...defaultSlideshowSettings, ...(raw as object) }
  }, slideshowSettingsSchema),
  /** LAN neighborhood discovery (tree Network section). */
  networkDiscovery: z.preprocess((raw) => {
    if (!raw || typeof raw !== 'object') return defaultNetworkDiscoverySettings
    return { ...defaultNetworkDiscoverySettings, ...(raw as object) }
  }, networkDiscoverySettingsSchema),
  /** Opt-in FTP/FTPS/SFTP remotes (D46). */
  remoteRepos: z.preprocess((raw) => {
    if (!raw || typeof raw !== 'object') return defaultRemoteReposSettings
    return { ...defaultRemoteReposSettings, ...(raw as object) }
  }, remoteReposSettingsSchema),
  /** Last ADS Manager dialog geometry (null = centered defaults). */
  adsManagerBounds: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().min(320).max(10000),
      height: z.number().min(240).max(10000)
    })
    .nullable()
    .catch(null),
  /** Last Power Rename dialog geometry (null = centered defaults). */
  powerRenameBounds: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().min(480).max(10000),
      height: z.number().min(360).max(10000),
      maximized: z.boolean().catch(false)
    })
    .nullable()
    .catch(null),
  /** Last Add/Edit remote connection dialog geometry. */
  remoteConnectionBounds: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().min(420).max(10000),
      height: z.number().min(360).max(10000),
      maximized: z.boolean().catch(false)
    })
    .nullable()
    .catch(null),
  /** Detached Compiled Lists window geometry. */
  compiledListsWindowBounds: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().min(320).max(10000),
      height: z.number().min(240).max(10000)
    })
    .nullable()
    .catch(null),
  /** Detached preview window geometry (not auto-reopened on launch). */
  previewWindowBounds: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().min(320).max(10000),
      height: z.number().min(240).max(10000),
      maximized: z.boolean().catch(false)
    })
    .nullable()
    .catch(null),
  /**
   * User-defined external context-menu commands + optional hidden built-ins (D41).
   */
  contextMenu: z.preprocess((raw) => {
    if (!raw || typeof raw !== 'object') return defaultContextMenuSettings
    const o = raw as {
      files?: unknown
      folders?: unknown
      hiddenBuiltins?: unknown
      builtinLayout?: unknown
      discovered?: unknown
    }
    return {
      files: sanitizeContextMenuCommands(o.files),
      folders: sanitizeContextMenuCommands(o.folders),
      hiddenBuiltins: sanitizeHiddenBuiltins(o.hiddenBuiltins),
      builtinLayout: sanitizeBuiltinLayout(o.builtinLayout),
      discovered: sanitizeDiscoveredSettings(o.discovered)
    }
  }, contextMenuSettingsSchema)
})

export type DetailsColumn = { id: DetailsColumnId; width: number }
export type Settings = z.infer<typeof settingsSchema>

export const defaultSettings: Settings = settingsSchema.parse({
  version: 1,
  theme: 'dark',
  customTheme: defaultCustomTheme,
  fontFamily: 'Segoe UI',
  fontSizePx: 13,
  iconSizePx: 20,
  tabEqualWidth: false,
  showTabIcons: true,
  foldersFirst: true,
  itemCheckboxes: false,
  defaultNewTabPath: '',
  confirmPermanentDeleteAlways: false,
  previewVisibleDefault: true,
  textPreviewMaxBytes: 2 * 1024 * 1024,
  vidThumbFrameMs: DEFAULT_VID_THUMB_FRAME_MS,
  previewVideoAutoplay: false,
  searchExcludeDirNames: ['node_modules', '.git', '.hg', '.svn', 'Thumbs.db'],
  searchIndexedOnly: false,
  searchMatchPath: false,
  searchMatchCase: false,
  searchWholeWord: false,
  searchRegex: false,
  searchFilters: [],
  searchBookmarks: [],
  powerSearchSaved: [],
  searchHttpEnabled: false,
  searchHttpPort: 8081,
  searchHttpToken: '',
  viewFilterEnabled: true,
  viewFilterPatterns: [],
  hideNameExtensions: ['lnk'],
  detailsNameWidth: 320,
  detailsColumns: defaultDetailsColumns,
  folderViews: [] satisfies FolderView[],
  layouts: [] satisfies WorkspaceLayout[],
  quickAccess: [],
  quickAccessPins: [],
  quickAccessHiddenDefaults: [],
  updatesFolder: DEFAULT_UPDATES_SOURCE,
  disableHardwareAcceleration: false,
  slideshowFeaturesEnabled: false,
  slideshow: defaultSlideshowSettings,
  networkDiscovery: defaultNetworkDiscoverySettings,
  remoteRepos: defaultRemoteReposSettings,
  adsManagerBounds: null,
  powerRenameBounds: null,
  remoteConnectionBounds: null,
  compiledListsWindowBounds: null,
  previewWindowBounds: null,
  contextMenu: defaultContextMenuSettings
})

export const settingsPatchSchema = settingsSchema
  .partial()
  .omit({ version: true })
  .extend({
    slideshow: slideshowSettingsSchema.partial().optional(),
    networkDiscovery: networkDiscoverySettingsSchema.partial().optional(),
    remoteRepos: remoteReposSettingsSchema.partial().optional(),
    contextMenu: contextMenuSettingsSchema.partial().optional()
  })
export type SettingsPatch = z.infer<typeof settingsPatchSchema>
