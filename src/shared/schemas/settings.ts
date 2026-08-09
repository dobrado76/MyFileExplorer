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
  MAX_SEARCH_BOOKMARKS,
  MAX_SEARCH_FILTERS,
  searchBookmarkSchema,
  searchFilterSchema,
  type SearchBookmark,
  type SearchFilter
} from './search'

export type { DetailsColumnId } from './columns'
export type { FolderView } from '../folderViews'
export type { WorkspaceLayout } from '../layouts'

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
  fontSizePx: z.number().min(9).max(28).catch(13),
  iconSizePx: z.number().min(12).max(40).catch(20),
  foldersFirst: z.boolean().catch(true),
  defaultNewTabPath: z.string().catch(''),
  confirmPermanentDeleteAlways: z.boolean().catch(false),
  previewVisibleDefault: z.boolean().catch(true),
  textPreviewMaxBytes: z.number().min(1024).catch(1048576),
  /** Delay between `!VIDTHUMB_CACHE` strip frames in icon views (ms). */
  vidThumbFrameMs: z
    .number()
    .int()
    .min(VID_THUMB_FRAME_MS_MIN)
    .max(VID_THUMB_FRAME_MS_MAX)
    .catch(DEFAULT_VID_THUMB_FRAME_MS),
  /** Auto-start preview `<video>` / `<audio>` when a media file is selected. */
  previewVideoAutoplay: z.boolean().catch(false),
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
  /** Folder scanned for `MyFileExplorer Setup x.y.z.exe` installers. */
  updatesFolder: z.string().catch(''),
  /**
   * Chromium GPU compositing off (Electron `app.disableHardwareAcceleration`).
   * Applied at process start — restart required after change. Frees VRAM when
   * sharing a GPU with training / other CUDA apps.
   */
  disableHardwareAcceleration: z.boolean().catch(false)
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
  foldersFirst: true,
  defaultNewTabPath: '',
  confirmPermanentDeleteAlways: false,
  previewVisibleDefault: true,
  textPreviewMaxBytes: 1048576,
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
  updatesFolder: '',
  disableHardwareAcceleration: false
})

export const settingsPatchSchema = settingsSchema.partial().omit({ version: true })
export type SettingsPatch = z.infer<typeof settingsPatchSchema>
