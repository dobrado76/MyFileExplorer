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
  regex: z.boolean().optional()
})
export type SearchQueryRequest = z.infer<typeof searchQueryRequestSchema>

export type SearchResultItem = {
  path: string
  name: string
  mtimeMs: number
  size: number
  isDir: boolean
  score?: number
}

export type SearchQueryResponse = {
  items: SearchResultItem[]
  partial: boolean
  source: 'index' | 'walk'
  /** True when `content:` / utf8content: scanning ran (D15 honesty). */
  contentSlow?: boolean
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
