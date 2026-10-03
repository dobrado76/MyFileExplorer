import { z } from 'zod'

export const undeleteStatusSchema = z.enum(['good', 'poor', 'unrecoverable'])
export type UndeleteStatus = z.infer<typeof undeleteStatusSchema>

export const undeleteCandidateSchema = z.object({
  /** Opaque token for recover (base64 of volume+frn+seq). */
  token: z.string().min(1),
  name: z.string(),
  /** Best-effort parent folder path when the directory chain is still in the MFT. */
  pathHint: z.string().nullable(),
  size: z.number().nonnegative(),
  status: undeleteStatusSchema,
  isDir: z.boolean(),
  mtimeMs: z.number().nullable()
})
export type UndeleteCandidate = z.infer<typeof undeleteCandidateSchema>

export const undeleteScanRequestSchema = z.object({
  volume: z
    .string()
    .regex(/^[A-Za-z]:\\?$/)
    .transform((v) => `${v.replace(/:\\?$/, '').toUpperCase()}:`)
})
export type UndeleteScanRequest = z.infer<typeof undeleteScanRequestSchema>

export const undeleteScanResponseSchema = z.object({
  volume: z.string(),
  items: z.array(undeleteCandidateSchema),
  scannedRecords: z.number().int().nonnegative(),
  elevated: z.boolean()
})
export type UndeleteScanResponse = z.infer<typeof undeleteScanResponseSchema>

export const undeleteRecoverRequestSchema = z.object({
  volume: z
    .string()
    .regex(/^[A-Za-z]:\\?$/)
    .transform((v) => `${v.replace(/:\\?$/, '').toUpperCase()}:`),
  tokens: z.array(z.string().min(1)).min(1),
  destDir: z.string().min(1),
  /** Absolute index of the first token in this chunk (multi-chunk recover). */
  progressOffset: z.number().int().nonnegative().optional(),
  /** Overall token count across all chunks. */
  progressTotal: z.number().int().positive().optional(),
  /** Keep the volume handle / MFT layout open for the next chunk. */
  keepOpen: z.boolean().optional()
})
export type UndeleteRecoverRequest = z.infer<typeof undeleteRecoverRequestSchema>

export const undeleteRecoverResponseSchema = z.object({
  recovered: z.array(z.object({ token: z.string(), path: z.string() })),
  failed: z.array(z.object({ token: z.string(), message: z.string() })),
  elevated: z.boolean()
})
export type UndeleteRecoverResponse = z.infer<typeof undeleteRecoverResponseSchema>
