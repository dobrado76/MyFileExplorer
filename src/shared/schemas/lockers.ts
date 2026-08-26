import { z } from 'zod'

/** Process holding a file/folder open (Restart Manager + CIM fallback). */
export type LockingProcess = {
  pid: number
  /** Display name (exe or Restart Manager app title). */
  name: string
  /** Absolute path to the executable when known. */
  exePath?: string
}

export const lockingProcessSchema = z.object({
  pid: z.number().int().positive(),
  name: z.string().min(1),
  exePath: z.string().min(1).optional()
})

export const findLockersRequestSchema = z.object({
  path: z.string().min(1)
})
export type FindLockersRequest = z.infer<typeof findLockersRequestSchema>

export const findLockersResponseSchema = z.object({
  lockers: z.array(lockingProcessSchema)
})
export type FindLockersResponse = z.infer<typeof findLockersResponseSchema>

export const endProcessRequestSchema = z.object({
  pid: z.number().int().positive()
})
export type EndProcessRequest = z.infer<typeof endProcessRequestSchema>
