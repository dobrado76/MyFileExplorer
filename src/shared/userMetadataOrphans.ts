/**
 * Orphan hygiene types for user metadata (D70 / AAA #2).
 * Orphans = ADS values whose field/option ids are no longer in the catalog.
 */

export type UserMetadataOrphanKind = 'field' | 'option'

export type UserMetadataOrphan = {
  path: string
  kind: UserMetadataOrphanKind
  fieldId: string
  optionId?: string
  /** Best-effort query key (e.g. parent field key for option orphans). */
  keyGuess?: string
}

export type UserMetadataOrphanScanResult = {
  orphans: UserMetadataOrphan[]
}

export type UserMetadataOrphanReconnectMapping = {
  path: string
  fromFieldId: string
  toFieldId: string
}

export type UserMetadataOrphanClearResult = {
  ok: true
  cleared: number
}

export type UserMetadataOrphanReconnectResult = {
  ok: true
  remapped: number
}
