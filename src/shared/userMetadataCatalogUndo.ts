import type { UserMetadataSettings } from './schemas/userMetadata'

/** Session catalog undo for the Metadata manager (not D23 file undo). */
export const MAX_USER_METADATA_CATALOG_UNDO = 30

function pushCapped<T>(stack: T[], entry: T, max: number): T[] {
  const next = [...stack, entry]
  if (next.length <= max) return next
  return next.slice(next.length - max)
}

export function cloneUserMetadataSettings(um: UserMetadataSettings): UserMetadataSettings {
  return structuredClone(um)
}

export function pushCatalogUndo(
  stack: UserMetadataSettings[],
  snapshot: UserMetadataSettings,
  max = MAX_USER_METADATA_CATALOG_UNDO
): UserMetadataSettings[] {
  return pushCapped(stack, cloneUserMetadataSettings(snapshot), max)
}

export function popCatalogUndo(
  stack: UserMetadataSettings[]
): { next: UserMetadataSettings[]; snapshot: UserMetadataSettings } | null {
  if (stack.length === 0) return null
  const snapshot = stack[stack.length - 1]!
  return { next: stack.slice(0, -1), snapshot }
}
