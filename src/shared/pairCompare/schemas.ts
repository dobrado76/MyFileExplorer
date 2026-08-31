import { z } from 'zod'
import { pairCompareMethodSchema } from '../schemas/pairFolders'

export const pairCompareStatusSchema = z.enum([
  'identical',
  'left_only',
  'right_only',
  'left_newer',
  'right_newer',
  'different',
  'type_conflict',
  'metadata_only',
  'inaccessible',
  'error'
])

export const compareEntryKindSchema = z.enum([
  'file',
  'directory',
  'symlink',
  'junction',
  'other'
])

export const compareEntrySnapshotSchema = z.object({
  absolutePath: z.string().min(1),
  relativePath: z.string(),
  kind: compareEntryKindSchema,
  size: z.number().nullable(),
  modifiedMs: z.number().nullable(),
  createdMs: z.number().nullable().optional(),
  fileId: z.string().nullable().optional(),
  volumeId: z.string().nullable().optional(),
  hash: z.string().nullable().optional(),
  attributes: z.number().nullable().optional()
})

export const pairCompareOptionsSchema = z.object({
  includeSubfolders: z.boolean(),
  followLinks: z.boolean(),
  includeHidden: z.boolean(),
  compareMethod: pairCompareMethodSchema,
  modifiedToleranceMs: z.number().int().min(0).max(60_000),
  ignoreEmptyFolders: z.boolean(),
  caseSensitive: z.union([z.boolean(), z.literal('auto')])
})

export const pairCompareStartSchema = z.object({
  leftRoot: z.string().min(1),
  rightRoot: z.string().min(1),
  options: pairCompareOptionsSchema
})

export const pairCompareSessionIdSchema = z.object({
  sessionId: z.string().min(1)
})

export const pairCompareRowSchema = z.object({
  id: z.string().min(1),
  relativePath: z.string(),
  depth: z.number().int().min(0),
  left: compareEntrySnapshotSchema.nullable(),
  right: compareEntrySnapshotSchema.nullable(),
  status: pairCompareStatusSchema,
  reason: z.string(),
  aggregate: z
    .object({
      identical: z.number(),
      different: z.number(),
      leftOnly: z.number(),
      rightOnly: z.number(),
      conflicts: z.number(),
      errors: z.number()
    })
    .optional()
})

export const pairComparisonResultSchema = z.object({
  sessionId: z.string().min(1),
  leftRoot: z.string().min(1),
  rightRoot: z.string().min(1),
  options: pairCompareOptionsSchema,
  createdAt: z.number(),
  rows: z.array(pairCompareRowSchema),
  counts: z.record(pairCompareStatusSchema, z.number()),
  incomplete: z.boolean(),
  scanErrors: z.array(z.object({ relativePath: z.string(), message: z.string() }))
})

export const pairSyncDirectionSchema = z.enum(['left_to_right', 'right_to_left', 'two_way'])
export const pairSyncPolicySchema = z.enum(['update', 'mirror', 'missing_only'])
export const pairSyncScopeSchema = z.enum(['visible', 'selected', 'entire'])
export const pairSyncActionSchema = z.enum([
  'copy',
  'replace',
  'create_folder',
  'trash',
  'delete_permanent',
  'skip',
  'conflict'
])

export const pairSyncBuildPlanSchema = z.object({
  sessionId: z.string().min(1),
  direction: pairSyncDirectionSchema,
  policy: pairSyncPolicySchema,
  scope: pairSyncScopeSchema,
  selectedRowIds: z.array(z.string()).optional(),
  visibleStatuses: z.array(pairCompareStatusSchema).optional()
})

export const pairSyncPlanEntrySchema = z.object({
  id: z.string().min(1),
  action: pairSyncActionSchema,
  relativePath: z.string(),
  sourcePath: z.string().nullable(),
  destinationPath: z.string().nullable(),
  reason: z.string(),
  bytes: z.number(),
  decision: z
    .enum(['use_left', 'use_right', 'keep_both', 'keep_recent', 'skip'])
    .nullable()
    .optional(),
  requiredDecision: z.boolean(),
  rowId: z.string().min(1)
})

export const pairSyncPlanSchema = z.object({
  planId: z.string().min(1),
  sessionId: z.string().min(1),
  direction: pairSyncDirectionSchema,
  policy: pairSyncPolicySchema,
  scope: pairSyncScopeSchema,
  leftRoot: z.string().min(1),
  rightRoot: z.string().min(1),
  createdAt: z.number(),
  incompleteSource: z.boolean(),
  entries: z.array(pairSyncPlanEntrySchema),
  summary: z.object({
    copy: z.number(),
    replace: z.number(),
    createFolder: z.number(),
    remove: z.number(),
    conflicts: z.number(),
    excluded: z.number(),
    bytes: z.number()
  })
})

export const pairPlanIdSchema = z.object({
  planId: z.string().min(1)
})

export const pairExecutePlanSchema = z.object({
  planId: z.string().min(1),
  approvedEntryIds: z.array(z.string()).optional(),
  decisions: z
    .array(
      z.object({
        entryId: z.string().min(1),
        decision: z.enum(['use_left', 'use_right', 'keep_both', 'keep_recent', 'skip'])
      })
    )
    .optional(),
  mirrorAck: z.boolean().optional()
})
