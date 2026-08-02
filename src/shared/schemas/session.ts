import { z } from 'zod'
import { DETAILS_COLUMN_IDS } from './columns'

export const viewModeSchema = z.enum([
  'extraLargeIcons',
  'largeIcons',
  'mediumIcons',
  'smallIcons',
  'list',
  'details'
])
export type ViewMode = z.infer<typeof viewModeSchema>

export const sortKeySchema = z.enum(['name', ...DETAILS_COLUMN_IDS])
export type SortKey = z.infer<typeof sortKeySchema>

export const sortSchema = z.object({
  key: sortKeySchema.catch('name'),
  dir: z.enum(['asc', 'desc']).catch('asc')
})
export type SortSpec = z.infer<typeof sortSchema>

/** Cap persisted tree expand paths per tab (session.json size / restore cost). */
export const MAX_TREE_EXPANDED = 400

export const tabStateSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  title: z.string().nullable().catch(null),
  viewMode: viewModeSchema.catch('largeIcons'),
  sort: sortSchema.catch({ key: 'name', dir: 'asc' }),
  historyBack: z.array(z.string()).catch([]),
  historyForward: z.array(z.string()).catch([]),
  selectedPaths: z.array(z.string()).catch([]),
  scrollOffset: z.number().catch(0),
  /** When set, the tab is scoped: this folder is the tree root and navigation stays inside it. */
  rootPath: z.string().nullable().catch(null),
  /** Folder-tree directories that were expanded in this tab (restored on launch). */
  treeExpanded: z
    .array(z.string())
    .catch([])
    .transform((arr) => arr.filter((p) => typeof p === 'string' && p.length > 0).slice(0, MAX_TREE_EXPANDED))
})
export type TabState = z.infer<typeof tabStateSchema>

export const splittersSchema = z.object({
  treeWidthPx: z.number().min(0).catch(240),
  previewWidthPx: z.number().min(0).catch(320),
  treeCollapsed: z.boolean().catch(false),
  previewCollapsed: z.boolean().catch(false)
})
export type Splitters = z.infer<typeof splittersSchema>

export const sessionSchema = z.object({
  version: z.literal(1).catch(1),
  activeTabId: z.string().nullable().catch(null),
  tabs: z.array(tabStateSchema).catch([]),
  splitters: splittersSchema.catch({
    treeWidthPx: 240,
    previewWidthPx: 320,
    treeCollapsed: false,
    previewCollapsed: false
  })
})
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
  }
}
