import { z } from 'zod'
import {
  DEFAULT_USN_JOURNAL_DELTA_BYTES,
  DEFAULT_USN_JOURNAL_MAX_BYTES,
  USN_JOURNAL_DELTA_BYTES_MAX,
  USN_JOURNAL_DELTA_BYTES_MIN,
  USN_JOURNAL_MAX_BYTES_MAX,
  USN_JOURNAL_MAX_BYTES_MIN
} from '../usn/format'

export const usnJournalStatusSchema = z.enum([
  'active',
  'absent',
  'deleting',
  'not-ntfs',
  'access-denied',
  'unsupported'
])

export type UsnJournalStatus = z.infer<typeof usnJournalStatusSchema>

export const usnJournalInfoSchema = z.object({
  journalId: z.string(),
  firstUsn: z.string(),
  nextUsn: z.string(),
  lowestValidUsn: z.string(),
  maxUsn: z.string(),
  maximumSize: z.string(),
  allocationDelta: z.string()
})

export type UsnJournalInfoDto = z.infer<typeof usnJournalInfoSchema>

export const usnQueryRequestSchema = z.object({
  path: z.string().min(1)
})

export const usnQueryResponseSchema = z.object({
  status: usnJournalStatusSchema,
  letter: z.string(),
  fileSystem: z.string().nullable(),
  journal: usnJournalInfoSchema.nullable(),
  needsElevation: z.boolean(),
  probeName: z.string().nullable().optional()
})

export type UsnQueryResponse = z.infer<typeof usnQueryResponseSchema>

export const usnEnableRequestSchema = z.object({
  path: z.string().min(1),
  maxBytes: z.number().int().min(USN_JOURNAL_MAX_BYTES_MIN).max(USN_JOURNAL_MAX_BYTES_MAX),
  deltaBytes: z.number().int().min(USN_JOURNAL_DELTA_BYTES_MIN).max(USN_JOURNAL_DELTA_BYTES_MAX),
  elevate: z.boolean().optional()
})

export const usnDisableRequestSchema = z.object({
  path: z.string().min(1),
  elevate: z.boolean().optional()
})

export const usnClearRequestSchema = usnEnableRequestSchema

export const usnRecentRequestSchema = z.object({
  path: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  elevate: z.boolean().optional()
})

export const usnRecentEntrySchema = z.object({
  usn: z.string(),
  name: z.string(),
  isDir: z.boolean(),
  reason: z.number(),
  timeMs: z.number().nullable()
})

export const usnRecentResponseSchema = z.object({
  entries: z.array(usnRecentEntrySchema),
  note: z.string().optional(),
  needsElevation: z.boolean().optional()
})

export type UsnRecentEntry = z.infer<typeof usnRecentEntrySchema>
export type UsnRecentResponse = z.infer<typeof usnRecentResponseSchema>

export { DEFAULT_USN_JOURNAL_MAX_BYTES, DEFAULT_USN_JOURNAL_DELTA_BYTES }
