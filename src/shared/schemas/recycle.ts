import { z } from 'zod'

/** One item currently in the Windows Recycle Bin. */
export const recycleBinItemSchema = z.object({
  name: z.string(),
  /** Original full path before delete. Not unique: two deletes can share it. */
  originalPath: z.string().min(1),
  /** Path under `$Recycle.Bin` (shell item / `$R…`) — unique row identity. */
  recyclePath: z.string().min(1),
  /** Original parent folder. */
  deletedFrom: z.string(),
  dateDeletedMs: z.number(),
  size: z.number(),
  isDir: z.boolean()
})
export type RecycleBinItem = z.infer<typeof recycleBinItemSchema>

export const recycleBinListResponseSchema = z.object({
  items: z.array(recycleBinItemSchema),
  /** True when listing stopped early (very large bins). */
  truncated: z.boolean().optional()
})
export type RecycleBinListResponse = z.infer<typeof recycleBinListResponseSchema>
