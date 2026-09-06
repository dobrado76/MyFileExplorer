/**
 * Metadata pack import dry-run / apply result shapes (D70 / AAA #3).
 */

export type UserMetadataPackDefinitionConflict = {
  setId: string
  fieldId: string
  reason: string
}

export type UserMetadataPackDryRunDefinitions = {
  /** Incoming sets not present locally (would be added). */
  addSets: number
  /** Incoming fields that would be added to existing or new sets. */
  addFields: number
  /** Incoming fields skipped because id already exists. */
  skipFields: number
  conflicts: UserMetadataPackDefinitionConflict[]
}

export type UserMetadataPackDryRunValues = {
  /** Host path exists and has no mfe_meta yet. */
  create: number
  /** Host path already has mfe_meta (would overwrite whole stream). */
  overwrite: number
  /** Relative path has no host file/folder. */
  skipMissing: number
}

export type UserMetadataPackDryRunResult = {
  dryRun: true
  definitions: UserMetadataPackDryRunDefinitions
  values: UserMetadataPackDryRunValues
}

export type UserMetadataPackApplyResult = {
  dryRun?: false
  written: number
  definitionsMerged: boolean
}

export type UserMetadataPackImportResult =
  | UserMetadataPackDryRunResult
  | UserMetadataPackApplyResult
