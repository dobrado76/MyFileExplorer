import { z } from 'zod'

export const searchScopeSchema = z.union([
  z.object({ type: z.literal('indexed') }),
  z.object({
    type: z.literal('folder'),
    path: z.string().min(1),
    recursive: z.boolean().default(true),
    useIndexIfCovered: z.boolean().default(true)
  })
])
export type SearchScope = z.infer<typeof searchScopeSchema>

export const searchQueryRequestSchema = z.object({
  query: z.string().min(1),
  scope: searchScopeSchema,
  limit: z.number().int().min(1).max(20000).default(2000),
  offset: z.number().int().min(0).default(0),
  matchPath: z.boolean().optional(),
  matchCase: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  regex: z.boolean().optional(),
  /** Renderer search generation — stale progress events must be ignored. */
  gen: z.number().int().optional()
})
export type SearchQueryRequest = z.infer<typeof searchQueryRequestSchema>

export type SearchResultItem = {
  path: string
  name: string
  mtimeMs: number
  size: number
  isDir: boolean
  /** Windows Hidden (or under a hidden / `!VIDTHUMB_CACHE` folder). */
  isHidden?: boolean
  score?: number
}

export type SearchQueryResponse = {
  items: SearchResultItem[]
  partial: boolean
  source: 'index' | 'walk'
  /** True when `content:` / utf8content: scanning ran (D15 honesty). */
  contentSlow?: boolean
  /** Set when the query has no positive name/filter — never dump the whole folder. */
  message?: string
}

export type IndexRootStatus = 'idle' | 'indexing' | 'ready' | 'error' | 'offline'
export type IndexRootKind = 'folder' | 'volume'
export type IndexRootMonitor = 'none' | 'watch' | 'usn' | 'walk'

export type IndexRootInfo = {
  path: string
  kind: IndexRootKind
  volume: string | null
  monitor: IndexRootMonitor
  status: IndexRootStatus
  addedAt: string
  lastIndexedAt: string | null
  fileCount: number
}

export const reindexRequestSchema = z.object({ rootPath: z.string().optional() })
export type ReindexRequest = z.infer<typeof reindexRequestSchema>

export const searchFilterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  query: z.string(),
  /** Optional Everything-style macro alias without trailing colon, e.g. `photos` → `photos:` */
  macro: z.string().optional()
})
export type SearchFilter = z.infer<typeof searchFilterSchema>

export const searchBookmarkSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  query: z.string(),
  scope: z.enum(['indexed', 'folder']).catch('indexed'),
  sortKey: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional()
})
export type SearchBookmark = z.infer<typeof searchBookmarkSchema>

export const MAX_SEARCH_FILTERS = 50
export const MAX_SEARCH_BOOKMARKS = 50
export const MAX_POWER_SEARCH_SAVED = 80

/** Visual Power Search builder fields (no target folder / indexed-only). */
export const powerSearchStateSchema = z.object({
  terms: z.string().catch(''),
  exclude: z.string().catch(''),
  excludeExtensions: z.string().catch(''),
  itemKind: z.enum(['any', 'file', 'folder']).catch('any'),
  types: z.array(z.string()).catch([]),
  sizePreset: z
    .enum(['', 'empty', 'tiny', 'small', 'medium', 'large', 'huge', 'custom'])
    .catch(''),
  sizeCustom: z.string().catch(''),
  dateModified: z
    .enum(['', 'today', 'yesterday', 'thisweek', 'thismonth', 'custom'])
    .catch(''),
  dateCustom: z.string().catch(''),
  extensions: z.string().catch(''),
  inFolder: z.string().catch(''),
  parentName: z.string().catch(''),
  pathContains: z.string().catch(''),
  pathPrefix: z.string().catch(''),
  startsWith: z.string().catch(''),
  endsWith: z.string().catch(''),
  attributes: z.array(z.enum(['h', 's', 'r', 'a'])).catch([]),
  emptyOnly: z.boolean().catch(false),
  content: z.string().catch(''),
  noteText: z.string().catch(''),
  noteStatus: z.string().catch(''),
  hasNote: z.boolean().catch(false),
  openTodos: z.boolean().catch(false),
  dupe: z.enum(['', 'name', 'size', 'namepart']).catch(''),
  childName: z.string().catch(''),
  depth: z.string().catch('')
})

export const powerSearchSavedSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  query: z.string(),
  builder: powerSearchStateSchema,
  matchPath: z.boolean().catch(false),
  matchCase: z.boolean().catch(false),
  wholeWord: z.boolean().catch(false),
  regex: z.boolean().catch(false),
  manualQuery: z.boolean().catch(false),
  updatedAt: z.number().catch(0)
})
export type PowerSearchSaved = z.infer<typeof powerSearchSavedSchema>

export function newPowerSearchSavedId(): string {
  return `ps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
