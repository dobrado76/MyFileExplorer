import { z } from 'zod'
import { DETAILS_COLUMN_IDS } from './columns'
import { coerceHistoryList, persistHistoryEntry } from '../tabHistory'

export const viewModeSchema = z.enum([
  'extraLargeIconsNoName',
  'extraLargeIcons',
  'largeIcons',
  'mediumIcons',
  'smallIcons',
  'list',
  'details'
])
export type ViewMode = z.infer<typeof viewModeSchema>

/** Icon/thumbnail grids. List and Details follow Behavior → Folders first. */
export function isThumbnailViewMode(mode: ViewMode): boolean {
  return mode !== 'list' && mode !== 'details'
}

export const sortKeySchema = z.enum(['name', ...DETAILS_COLUMN_IDS])
export type SortKey = z.infer<typeof sortKeySchema>

export const sortSchema = z.object({
  key: sortKeySchema.catch('name'),
  dir: z.enum(['asc', 'desc']).catch('asc')
})
export type SortSpec = z.infer<typeof sortSchema>

/** Cap persisted tree expand paths per tab (session.json size / restore cost). */
export const MAX_TREE_EXPANDED = 400

/** Optional Lucide React icon on a tab (PascalCase name from `lucide-react` `icons`). */
export const tabIconSchema = z
  .object({
    name: z.string().min(1).max(80),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .catch('#60a5fa')
  })
  .nullable()
  .catch(null)
export type TabIcon = z.infer<typeof tabIconSchema>

const historyEntrySchema = z.union([
  z.object({
    kind: z.literal('folder'),
    path: z.string().min(1),
    scrollOffset: z.number().nonnegative().optional(),
    focusPath: z.string().min(1).optional()
  }),
  z.object({
    kind: z.literal('search'),
    query: z.string(),
    scopePath: z.string().min(1),
    indexedOnly: z.boolean()
  })
])

const historyListSchema = z.preprocess(
  (raw) => coerceHistoryList(raw).map(persistHistoryEntry),
  z.array(historyEntrySchema)
)

export const tabSearchPersistSchema = z
  .object({
    active: z.boolean().catch(false),
    query: z.string().catch(''),
    indexedOnly: z.boolean().catch(false)
  })
  .catch({ active: false, query: '', indexedOnly: false })
export type TabSearchPersist = z.infer<typeof tabSearchPersistSchema>

export const tabStateSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  title: z.string().nullable().catch(null),
  icon: tabIconSchema,
  viewMode: viewModeSchema.catch('largeIcons'),
  sort: sortSchema.catch({ key: 'name', dir: 'asc' }),
  historyBack: historyListSchema.catch([]),
  historyForward: historyListSchema.catch([]),
  search: tabSearchPersistSchema,
  selectedPaths: z.array(z.string()).catch([]),
  scrollOffset: z.number().catch(0),
  /** When set, the tab is scoped: this folder is the tree root and navigation stays inside it. */
  rootPath: z.string().nullable().catch(null),
  /** Folder-tree directories that were expanded in this tab (restored on launch). */
  treeExpanded: z
    .array(z.string())
    .catch([])
    .transform((arr) =>
      arr.filter((p) => typeof p === 'string' && p.length > 0).slice(0, MAX_TREE_EXPANDED)
    )
})
export type TabState = z.infer<typeof tabStateSchema>

export const splittersSchema = z.object({
  treeWidthPx: z.number().min(0).catch(240),
  previewWidthPx: z.number().min(0).catch(320),
  treeCollapsed: z.boolean().catch(false),
  previewCollapsed: z.boolean().catch(false)
})
export type Splitters = z.infer<typeof splittersSchema>

/** Multi-pane file view layout (D31). */
export const viewLayoutSchema = z.union([z.literal(1), z.literal(2), z.literal(4)])
export type ViewLayout = z.infer<typeof viewLayoutSchema>

function clampRatio(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.min(0.85, Math.max(0.15, n))
}

function sanitizePaneTabIds(
  raw: unknown,
  layout: ViewLayout,
  activeTabId: string | null
): (string | null)[] {
  const arr = Array.isArray(raw) ? raw : []
  const out: (string | null)[] = []
  for (let i = 0; i < layout; i++) {
    const v = arr[i]
    if (typeof v === 'string' && v.length > 0) out.push(v)
    else out.push(null)
  }
  // Ensure at least the active tab is visible in single-pane / first slot when empty.
  if (out.length > 0 && out.every((id) => id == null) && activeTabId) {
    return [activeTabId, ...out.slice(1)]
  }
  return out
}

export const sessionSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== 'object') return raw
    const o = raw as Record<string, unknown>
    const layoutRaw = o.viewLayout
    const layout: ViewLayout = layoutRaw === 2 || layoutRaw === 4 || layoutRaw === 1 ? layoutRaw : 1
    const activeTabId =
      typeof o.activeTabId === 'string' && o.activeTabId.length > 0 ? o.activeTabId : null
    return {
      ...o,
      viewLayout: layout,
      paneTabIds: sanitizePaneTabIds(o.paneTabIds, layout, activeTabId),
      focusedPaneIndex:
        typeof o.focusedPaneIndex === 'number' && Number.isFinite(o.focusedPaneIndex)
          ? Math.min(layout - 1, Math.max(0, Math.floor(o.focusedPaneIndex)))
          : 0,
      paneSplitCols: clampRatio(typeof o.paneSplitCols === 'number' ? o.paneSplitCols : 0.5),
      paneSplitRows: clampRatio(typeof o.paneSplitRows === 'number' ? o.paneSplitRows : 0.5)
    }
  },
  z.object({
    version: z.literal(1).catch(1),
    activeTabId: z.string().nullable().catch(null),
    tabs: z.array(tabStateSchema).catch([]),
    splitters: splittersSchema.catch({
      treeWidthPx: 240,
      previewWidthPx: 320,
      treeCollapsed: false,
      previewCollapsed: false
    }),
    viewLayout: viewLayoutSchema.catch(1),
    paneTabIds: z.array(z.string().nullable()).catch([]),
    focusedPaneIndex: z.number().int().min(0).catch(0),
    paneSplitCols: z.number().min(0.15).max(0.85).catch(0.5),
    paneSplitRows: z.number().min(0.15).max(0.85).catch(0.5)
  })
)
export type SessionState = z.infer<typeof sessionSchema>

export const defaultSession: SessionState = {
  version: 1,
  activeTabId: null,
  tabs: [],
  splitters: {
    treeWidthPx: 240,
    previewWidthPx: 320,
    treeCollapsed: false,
    previewCollapsed: false
  },
  viewLayout: 1,
  paneTabIds: [null],
  focusedPaneIndex: 0,
  paneSplitCols: 0.5,
  paneSplitRows: 0.5
}
