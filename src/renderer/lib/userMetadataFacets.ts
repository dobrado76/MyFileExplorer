import type { UserMetadataField } from '@shared/schemas/userMetadata'

/** True when any facet has at least one selected token. */
export function userMetadataFacetsActive(facets: Record<string, string[]>): boolean {
  for (const ids of Object.values(facets)) {
    if (ids.length > 0) return true
  }
  return false
}

/**
 * Exclude a listing path when active facets do not match its metadata values.
 * Tokens: boolean → `'true'`/`'false'`; choice/iconTags/multiChoice → option ids.
 * multiChoice / iconTags: any-of selected options.
 */
export function isExcludedByUserMetadataFacets(
  values: Record<string, unknown> | undefined | null,
  facets: Record<string, string[]>,
  fields: UserMetadataField[]
): boolean {
  // Not fetched yet — keep visible until session cache fills.
  if (values === undefined) return false
  for (const field of fields) {
    const sel = facets[field.id]
    if (!sel || sel.length === 0) continue
    const raw = values?.[field.id]
    if (field.type === 'boolean') {
      const token = raw === true ? 'true' : raw === false ? 'false' : null
      if (token == null || !sel.includes(token)) return true
      continue
    }
    if (field.type === 'choice') {
      if (typeof raw !== 'string' || !sel.includes(raw)) return true
      continue
    }
    if (field.type === 'multiChoice' || field.type === 'iconTags') {
      const arr = Array.isArray(raw)
        ? raw.filter((x): x is string => typeof x === 'string')
        : []
      if (!sel.some((id) => arr.includes(id))) return true
    }
  }
  return false
}

/** Stable key fragment for view-order cache invalidation. */
export function userMetadataFacetsFilterKey(facets: Record<string, string[]>): string {
  const keys = Object.keys(facets).sort()
  return keys
    .map((k) => {
      const ids = [...(facets[k] ?? [])].sort()
      return ids.length ? `${k}=${ids.join(',')}` : ''
    })
    .filter(Boolean)
    .join('|')
}
