import { z } from 'zod'
import type { ErrCode } from '../result'

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

export const calculateFolderStatisticsRequestSchema = z.object({
  path: z.string().min(1),
  /** When true, skip folders that already have a valid TotalSize ADS stream. */
  skipTagged: z.boolean().optional(),
  /** When true, omit folders that fail and keep walking. */
  skipOnError: z.boolean().optional()
})
export type CalculateFolderStatisticsRequest = z.infer<
  typeof calculateFolderStatisticsRequestSchema
>

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
export type PathPair = { from: string; to: string }

export type OpIssueKind =
  | 'name_conflict'
  | 'busy'
  | 'not_allowed'
  | 'not_found'
  | 'path_too_long'
  | 'io'
  | 'fatal'

export type OpIssue = {
  kind: OpIssueKind
  code: ErrCode
  source: string
  dest?: string
  message: string
  sourceMtimeMs?: number
  destMtimeMs?: number
}

export type CopyResponse = {
  copied: string[]
  skipped: string[]
  issues: OpIssue[]
  aborted?: 'cancelled' | 'fatal'
}
export type MoveResponse = {
  moved: string[]
  moves: PathPair[]
  skipped: string[]
  issues: OpIssue[]
  aborted?: 'cancelled' | 'fatal'
}
export type TrashResponse = {
  trashed: string[]
  issues: OpIssue[]
  aborted?: 'cancelled' | 'fatal'
}
export type DeletePermanentResponse = {
  deleted: string[]
  issues: OpIssue[]
  aborted?: 'cancelled' | 'fatal'
}

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

export type ConflictDecision = 'replace' | 'skip' | 'rename' | 'keep_newer'

export const issueDecisionSchema = z.enum(['replace', 'skip', 'rename', 'keep_newer', 'retry'])
export type IssueDecision = z.infer<typeof issueDecisionSchema>

export const resolveIssuesRequestSchema = z.object({
  op: z.enum(['copy', 'move', 'trash', 'delete']),
  destinationDir: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        source: z.string().min(1),
        dest: z.string().optional(),
        decision: issueDecisionSchema,
        sourceMtimeMs: z.number().optional(),
        destMtimeMs: z.number().optional()
      })
    )
    .min(1)
})
export type ResolveIssuesRequest = z.infer<typeof resolveIssuesRequestSchema>
export type ResolveIssuesResponse = {
  copied: string[]
  moved: string[]
  moves: PathPair[]
  trashed: string[]
  deleted: string[]
  skipped: number
  issues: OpIssue[]
}

export const pathsRequestSchema = z.object({ paths: z.array(z.string().min(1)).min(1) })
export type PathsRequest = z.infer<typeof pathsRequestSchema>

export type DriveInfo = {
  path: string
  /** Tree display, e.g. `C:` or `C: — Games`. */
  label: string
  /** Editable volume label only (empty when unnamed). */
  volumeName: string
  /** From GetDriveTypeW — used for mapped-letter Disconnect, etc. */
  driveType?: 'fixed' | 'removable' | 'remote' | 'cdrom' | 'ramdisk' | 'unknown'
  /**
   * Mapped network letter that is currently disconnected (red X in Explorer).
   * Still listed so the user can click to reconnect without opening Explorer first.
   */
  offline?: boolean
  /** UNC target for mapped letters when known (`\\server\share`). */
  remotePath?: string
}

export const setVolumeLabelRequestSchema = z.object({
  path: z.string().min(1),
  /** Empty string clears the volume label. */
  name: z.string().max(32)
})
export type SetVolumeLabelRequest = z.infer<typeof setVolumeLabelRequestSchema>
