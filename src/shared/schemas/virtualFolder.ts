import { z } from 'zod'
import {
  VIRTUAL_FOLDER_FORMAT,
  VIRTUAL_FOLDER_VERSION,
  normalizeVirtualFolderEntryKind,
  type VirtualFolderDocument,
  type VirtualFolderEntry,
  type VirtualFolderMembership
} from '../virtualFolder'
import type { DirEntry } from './fs'

export const virtualFolderEntryKindSchema = z.enum(['file', 'folder', 'virtualFolder'])

export const virtualFolderSettingsSchema = z
  .object({
    manualOrder: z.boolean().optional()
  })
  .passthrough()

export const virtualFolderEntrySchema = z
  .object({
    id: z.string().min(1),
    kind: virtualFolderEntryKindSchema,
    path: z.string().min(1),
    relative: z.boolean().optional(),
    label: z.string().optional(),
    note: z.string().optional()
  })
  .passthrough()

export const virtualFolderDocumentSchema = z
  .object({
    format: z.literal(VIRTUAL_FOLDER_FORMAT),
    version: z.literal(VIRTUAL_FOLDER_VERSION),
    id: z.string().min(1),
    created: z.string().optional(),
    modified: z.string().optional(),
    settings: virtualFolderSettingsSchema.optional(),
    entries: z.array(z.unknown())
  })
  .passthrough()

export type ParseVirtualFolderResult =
  | {
      ok: true
      document: VirtualFolderDocument
      skippedEntries: number
      warnings: string[]
    }
  | { ok: false; error: string }

/**
 * Parse and validate a Virtual Folder JSON document.
 */
export function parseVirtualFolderJson(raw: string): ParseVirtualFolderResult {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Invalid JSON' }
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Document must be a JSON object' }
  }
  const root = data as Record<string, unknown>
  if (root.format !== VIRTUAL_FOLDER_FORMAT) {
    return {
      ok: false,
      error: `Unsupported format (expected ${VIRTUAL_FOLDER_FORMAT})`
    }
  }
  if (root.version !== VIRTUAL_FOLDER_VERSION) {
    if (typeof root.version === 'number' && root.version > VIRTUAL_FOLDER_VERSION) {
      return {
        ok: false,
        error: `Unsupported Virtual Folder version ${root.version} (this app supports ${VIRTUAL_FOLDER_VERSION})`
      }
    }
    return { ok: false, error: `Unsupported Virtual Folder version` }
  }
  const parsed = virtualFolderDocumentSchema.safeParse(data)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid Virtual Folder document'
    }
  }

  const warnings: string[] = []
  const entries: VirtualFolderEntry[] = []
  let skipped = 0
  const rawEntries = Array.isArray(root.entries) ? root.entries : []
  for (const item of rawEntries) {
    const er = virtualFolderEntrySchema.safeParse(item)
    if (!er.success) {
      skipped++
      continue
    }
    const kind = normalizeVirtualFolderEntryKind(er.data.kind)
    if (!kind) {
      skipped++
      continue
    }
    entries.push({
      id: er.data.id,
      kind,
      path: er.data.path,
      ...(er.data.relative != null ? { relative: er.data.relative } : {}),
      ...(er.data.label != null ? { label: er.data.label } : {}),
      ...(er.data.note != null ? { note: er.data.note } : {})
    })
  }
  if (skipped > 0) {
    warnings.push(`Skipped ${skipped} invalid entr${skipped === 1 ? 'y' : 'ies'}`)
  }

  const document: VirtualFolderDocument = {
    format: VIRTUAL_FOLDER_FORMAT,
    version: VIRTUAL_FOLDER_VERSION,
    id: parsed.data.id,
    ...(parsed.data.created ? { created: parsed.data.created } : {}),
    ...(parsed.data.modified ? { modified: parsed.data.modified } : {}),
    ...(parsed.data.settings
      ? { settings: { manualOrder: parsed.data.settings.manualOrder } }
      : {}),
    entries
  }
  return { ok: true, document, skippedEntries: skipped, warnings }
}

export const virtualFolderPathRequestSchema = z.object({
  path: z.string().min(1)
})

export const virtualFolderAddRequestSchema = z.object({
  documentPath: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  expectedMtimeMs: z.number().optional()
})

export const virtualFolderRemoveRequestSchema = z.object({
  documentPath: z.string().min(1),
  entryIds: z.array(z.string().min(1)).min(1),
  expectedMtimeMs: z.number().optional()
})

export const virtualFolderReorderRequestSchema = z.object({
  documentPath: z.string().min(1),
  entryIds: z.array(z.string().min(1)),
  expectedMtimeMs: z.number().optional()
})

export const virtualFolderRelinkRequestSchema = z.object({
  documentPath: z.string().min(1),
  entryId: z.string().min(1),
  newPath: z.string().min(1),
  expectedMtimeMs: z.number().optional()
})

export const virtualFolderSetLabelRequestSchema = z.object({
  documentPath: z.string().min(1),
  entryId: z.string().min(1),
  label: z.string().nullable(),
  expectedMtimeMs: z.number().optional()
})

export const virtualFolderCreateRequestSchema = z.object({
  parentDir: z.string().min(1),
  name: z.string().min(1).optional()
})

export const virtualFolderUpdatePathsRequestSchema = z.object({
  documentPath: z.string().min(1),
  renames: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })).min(1),
  expectedMtimeMs: z.number().optional()
})

export type VirtualFolderListItem = {
  entry: DirEntry
  membership: VirtualFolderMembership
}

export type VirtualFolderListResponse = {
  path: string
  document: VirtualFolderDocument
  mtimeMs: number
  readOnly: boolean
  entries: VirtualFolderListItem[]
  warnings: string[]
}

export type VirtualFolderMutateResponse = {
  document: VirtualFolderDocument
  mtimeMs: number
  added?: number
  skippedDuplicates?: number
  removed?: number
}

export type VirtualFolderPreviewStats = {
  entryCount: number
  fileCount: number
  folderCount: number
  virtualFolderCount: number
  missingCount: number
  knownFileBytes: number
  locationSamples: string[]
}
