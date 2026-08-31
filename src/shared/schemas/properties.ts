import { z } from 'zod'

export type PropertiesKind = 'file' | 'dir' | 'drive' | 'symlink' | 'missing' | 'multi'

export type DriveProperties = {
  capacityBytes: number
  freeBytes: number
  usedBytes: number
  fileSystem: string | null
  volumeLabel: string | null
  driveType: string | null
}

export type PropertiesModel = {
  path: string
  name: string
  location: string | null
  kind: PropertiesKind
  typeLabel: string
  sizeBytes: number | null
  /** Immediate children only (folders); null when not applicable. */
  contains: { files: number; folders: number } | null
  /** True when a recursive folder measure can be requested. */
  canMeasure: boolean
  /**
   * Multi-select combined sheet: folder paths to measure recursively and sum
   * into Size / Contains (with `sizeBytes` as the already-known file total).
   */
  measurePaths?: string[]
  /** Multi-select: all selected paths. */
  paths?: string[]
  createdMs: number | null
  modifiedMs: number | null
  accessedMs: number | null
  attributes: string[]
  drive: DriveProperties | null
  linkTarget: string | null
}

export type FolderMeasureResult = {
  path: string
  totalBytes: number
  fileCount: number
  folderCount: number
  truncated: boolean
}

export const propertiesRequestSchema = z.object({ path: z.string().min(1) })
export type PropertiesRequest = z.infer<typeof propertiesRequestSchema>

export const propertiesCombinedRequestSchema = z.object({
  paths: z.array(z.string().min(1)).min(1)
})
export type PropertiesCombinedRequest = z.infer<typeof propertiesCombinedRequestSchema>

export const openPropertiesWindowsRequestSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  /** Shift+Properties: one OS window per path. Default = one combined sheet. */
  separate: z.boolean().optional()
})
export type OpenPropertiesWindowsRequest = z.infer<typeof openPropertiesWindowsRequestSchema>

export const setAttributesRequestSchema = z.object({
  path: z.string().min(1),
  readOnly: z.boolean(),
  hidden: z.boolean(),
  archive: z.boolean(),
  system: z.boolean()
})
export type SetAttributesRequest = z.infer<typeof setAttributesRequestSchema>

export type SetAttributesResponse = {
  path: string
  attributes: string[]
  readOnly: boolean
  hidden: boolean
  archive: boolean
  system: boolean
}
