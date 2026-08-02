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
  limit: z.number().int().min(1).max(5000).default(500),
  offset: z.number().int().min(0).default(0)
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
}

export type IndexRootStatus = 'idle' | 'indexing' | 'ready' | 'error'

export type IndexRootInfo = {
  path: string
  status: IndexRootStatus
  addedAt: string
  lastIndexedAt: string | null
  fileCount: number
}

export const reindexRequestSchema = z.object({ rootPath: z.string().optional() })
export type ReindexRequest = z.infer<typeof reindexRequestSchema>
