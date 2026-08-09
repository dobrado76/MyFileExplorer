import { z } from 'zod'

export const entryKindSchema = z.enum(['file', 'dir', 'symlink'])
export type EntryKind = z.infer<typeof entryKindSchema>

export const dirEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: entryKindSchema,
  size: z.number(),
  mtimeMs: z.number(),
  birthtimeMs: z.number().catch(0),
  ext: z.string(),
  isHidden: z.boolean()
})
export type DirEntry = z.infer<typeof dirEntrySchema>

export type StatResult = {
  path: string
  exists: boolean
  kind: EntryKind | null
  size: number
  mtimeMs: number
  ctimeMs: number
  birthtimeMs: number
  isReadonly: boolean
}

export const pathRequestSchema = z.object({ path: z.string().min(1) })
export type PathRequest = z.infer<typeof pathRequestSchema>

export const listRequestSchema = z.object({
  path: z.string().min(1),
  includeHidden: z.boolean().optional()
})
export type ListRequest = z.infer<typeof listRequestSchema>
export type ListResponse = { path: string; entries: DirEntry[] }

export const nameInParentRequestSchema = z.object({
  parent: z.string().min(1),
  name: z
    .string()
    .min(1)
    .max(255)
    .refine((n) => !/[\\/:*?"<>|]/.test(n), 'Name contains invalid characters')
    .refine((n) => n !== '.' && n !== '..', 'Invalid name')
})
export type NameInParentRequest = z.infer<typeof nameInParentRequestSchema>

export const renameRequestSchema = z.object({
  path: z.string().min(1),
  newName: z
    .string()
    .min(1)
    .max(255)
    .refine((n) => !/[\\/:*?"<>|]/.test(n), 'Name contains invalid characters')
    .refine((n) => n !== '.' && n !== '..', 'Invalid name')
})
export type RenameRequest = z.infer<typeof renameRequestSchema>

export const conflictPolicySchema = z.enum(['fail', 'replace', 'skip', 'rename'])
export type ConflictPolicy = z.infer<typeof conflictPolicySchema>

export const transferRequestSchema = z.object({
  sources: z.array(z.string().min(1)).min(1),
  destinationDir: z.string().min(1),
  conflictPolicy: conflictPolicySchema.default('fail')
})
export type TransferRequest = z.infer<typeof transferRequestSchema>
export type CopyResponse = { copied: string[]; skipped: string[] }
export type PathPair = { from: string; to: string }
export type MoveResponse = { moved: string[]; moves: PathPair[]; skipped: string[] }

export const relocateRequestSchema = z.object({
  pairs: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1)
      })
    )
    .min(1)
})
export type RelocateRequest = z.infer<typeof relocateRequestSchema>

export const checkConflictsRequestSchema = z.object({
  sources: z.array(z.string().min(1)).min(1),
  destinationDir: z.string().min(1)
})
export type CheckConflictsRequest = z.infer<typeof checkConflictsRequestSchema>

/** One side of a name conflict (incoming source vs existing destination). */
export type ConflictSide = {
  path: string
  kind: EntryKind | null
  size: number
  mtimeMs: number
  birthtimeMs: number
  ext: string
  width: number | null
  height: number | null
}

export type ConflictItem = {
  name: string
  source: ConflictSide
  destination: ConflictSide
}

export type CheckConflictsResponse = {
  /** Conflicting base names (legacy / quick list). */
  conflicts: string[]
  /** Full compare payload for the conflict dialog. */
  items: ConflictItem[]
}

export type ConflictDecision = 'replace' | 'skip' | 'rename'

export const pathsRequestSchema = z.object({ paths: z.array(z.string().min(1)).min(1) })
export type PathsRequest = z.infer<typeof pathsRequestSchema>

export type DriveInfo = {
  path: string
  /** Tree display, e.g. `C:` or `C: — Games`. */
  label: string
  /** Editable volume label only (empty when unnamed). */
  volumeName: string
}

export const setVolumeLabelRequestSchema = z.object({
  path: z.string().min(1),
  /** Empty string clears the volume label. */
  name: z.string().max(32)
})
export type SetVolumeLabelRequest = z.infer<typeof setVolumeLabelRequestSchema>
