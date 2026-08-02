import { z } from 'zod'
import { detailsColumnIdSchema, ASYNC_COLUMN_IDS } from './columns'

export const metaGetManyRequestSchema = z.object({
  paths: z.array(z.string().min(1)).max(200),
  /** Which async columns are needed (drives what we extract). */
  columns: z.array(detailsColumnIdSchema).min(1).max(ASYNC_COLUMN_IDS.length)
})
export type MetaGetManyRequest = z.infer<typeof metaGetManyRequestSchema>

export const metaGetManyResponseSchema = z.object({
  /** path (as requested) → sparse column values */
  values: z.record(z.string(), z.record(z.string(), z.string()))
})
export type MetaGetManyResponse = z.infer<typeof metaGetManyResponseSchema>
