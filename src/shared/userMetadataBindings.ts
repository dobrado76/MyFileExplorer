/**
 * Per-folder metadata set bindings (D70) — resolve like folder views:
 * exact path wins; else longest recursive ancestor. Winning binding may have setId null
 * (explicit No metadata).
 */

import { isUnderPath, normalizeSlashes, pathKey, pathSpecificity, samePath, stripTrailingSep } from './paths'
import {
  MAX_USER_METADATA_BINDINGS,
  setById,
  type UserMetadataBinding,
  type UserMetadataSet,
  type UserMetadataSettings
} from './schemas/userMetadata'

export type { UserMetadataBinding }

/** Parent directory of a path (Windows-style). Volume roots stay as `C:\`. */
export function parentPath(p: string): string {
  const n = stripTrailingSep(normalizeSlashes(p))
  if (/^[a-zA-Z]:$/i.test(n)) return `${n}\\`
  const i = n.lastIndexOf('\\')
  if (i < 0) return n
  if (i === 2 && /^[a-zA-Z]:/i.test(n)) return n.slice(0, 3)
  return n.slice(0, i)
}

/**
 * Path used to resolve which metadata set applies.
 * Files → parent folder; folders → themselves.
 */
export function metadataScopePath(itemPath: string, isDirectory: boolean): string {
  return isDirectory ? itemPath : parentPath(itemPath)
}

/** Exact match first; else longest recursive ancestor. */
export function resolveMetadataBinding(
  path: string,
  list: UserMetadataBinding[]
): UserMetadataBinding | null {
  if (!path || list.length === 0) return null
  let exact: UserMetadataBinding | null = null
  let bestAncestor: UserMetadataBinding | null = null
  let bestSpec = -1
  for (const entry of list) {
    if (samePath(entry.path, path)) {
      exact = entry
      break
    }
    if (entry.recursive && isUnderPath(path, entry.path)) {
      const spec = pathSpecificity(entry.path)
      if (spec > bestSpec) {
        bestSpec = spec
        bestAncestor = entry
      }
    }
  }
  return exact ?? bestAncestor
}

export function findExactMetadataBinding(
  path: string,
  list: UserMetadataBinding[]
): UserMetadataBinding | null {
  return list.find((e) => samePath(e.path, path)) ?? null
}

/** Resolved set, or null when unbound / explicit No metadata / dangling setId. */
export function resolveMetadataSet(
  path: string,
  settings: UserMetadataSettings
): UserMetadataSet | null {
  const hit = resolveMetadataBinding(path, settings.bindings)
  if (!hit || hit.setId == null) return null
  return setById(settings, hit.setId) ?? null
}

export function fieldsForPath(
  path: string,
  settings: UserMetadataSettings
): import('./schemas/userMetadata').UserMetadataField[] {
  return resolveMetadataSet(path, settings)?.fields ?? []
}

export function upsertMetadataBinding(
  list: UserMetadataBinding[],
  entry: UserMetadataBinding
): UserMetadataBinding[] {
  const key = pathKey(entry.path)
  const without = list.filter((e) => pathKey(e.path) !== key)
  const next = [...without, { ...entry, path: entry.path }]
  if (next.length <= MAX_USER_METADATA_BINDINGS) return next
  return next.slice(next.length - MAX_USER_METADATA_BINDINGS)
}

export function removeMetadataBinding(
  list: UserMetadataBinding[],
  path: string
): UserMetadataBinding[] {
  const key = pathKey(path)
  return list.filter((e) => pathKey(e.path) !== key)
}

/** Drop bindings that reference a deleted set (keeps explicit null bindings). */
export function removeBindingsForSet(
  list: UserMetadataBinding[],
  setId: string
): UserMetadataBinding[] {
  return list.filter((e) => e.setId !== setId)
}

export function countBindingsForSet(list: UserMetadataBinding[], setId: string): number {
  return list.filter((e) => e.setId === setId).length
}
