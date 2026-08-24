import { z } from 'zod'

export const createLinkTypeSchema = z.enum(['symlink', 'hard', 'junction'])
export type CreateLinkType = z.infer<typeof createLinkTypeSchema>

export const createLinkRequestSchema = z.object({
  type: createLinkTypeSchema,
  source: z.string().min(1),
  destDir: z.string().min(1),
  name: z.string().min(1).max(240).optional()
})
export type CreateLinkRequest = z.infer<typeof createLinkRequestSchema>
