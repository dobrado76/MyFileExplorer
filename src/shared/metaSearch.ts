/**
 * Shared match logic for Power Search meta.<key>: / hasmeta: (D70).
 * ADS values are opaque field/option ids; queries use human keys resolved via catalog.
 * Duplicate keys across sets are type-compatible; a raw key clause ORs across those field ids.
 */

import type { UserMetadataDoc, UserMetadataField } from './schemas/userMetadata'
import {
  fieldById,
  fieldsBySearchKey,
  optionByKey,
  optionIdsForSearchKey
} from './schemas/userMetadata'

export type MetaSearchClause = {
  /** Primary opaque field id (builder / single-field). */
  fieldId: string
  /** When set, clause matches if ANY of these field ids satisfy the predicate. */
  fieldIds?: string[]
  /**
   * - 'present' — hasmeta.field: or meta.field: with empty value
   * - 'eq' — equality / membership
   * - 'cmp' — number compare with op
   */
  mode: 'present' | 'eq' | 'cmp'
  /** For choice: option id; for text/date/boolean/number: typed value. */
  value?: string | number | boolean
  /** choice / multiChoice: option ids (union across compatible fields). */
  optionIds?: string[]
  cmpOp?: '>=' | '<=' | '>' | '<' | '='
  cmpNum?: number
}

export type MetaSearchFilter = {
  /** Any mfe_meta stream with at least one value. */
  hasMeta: boolean
  excludeHasMeta: boolean
  /** Require these fields present (hasmeta.<key>:). */
  fieldPresent: string[]
  excludeFieldPresent: string[]
  clauses: MetaSearchClause[]
}

export function metaFilterActive(f: MetaSearchFilter | null | undefined): boolean {
  if (!f) return false
  return Boolean(
    f.hasMeta ||
      f.excludeHasMeta ||
      f.fieldPresent.length ||
      f.excludeFieldPresent.length ||
      f.clauses.length
  )
}

export function metaDocPresent(doc: UserMetadataDoc | null | undefined): boolean {
  if (!doc?.values) return false
  return Object.keys(doc.values).some((k) => {
    const v = doc.values[k]
    if (v == null || v === '') return false
    if (Array.isArray(v) && v.length === 0) return false
    return true
  })
}

function fieldHasValue(doc: UserMetadataDoc | null, fieldId: string): boolean {
  if (!doc?.values) return false
  const v = doc.values[fieldId]
  if (v == null || v === '') return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

function clauseMatchesOne(
  doc: UserMetadataDoc | null,
  c: MetaSearchClause,
  fieldId: string,
  catalog: UserMetadataField[]
): boolean {
  if (!doc) return false
  const raw = doc.values[fieldId]
  if (c.mode === 'present') return fieldHasValue(doc, fieldId)

  if (c.mode === 'cmp') {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || c.cmpNum == null || !c.cmpOp) {
      return false
    }
    switch (c.cmpOp) {
      case '>=':
        return raw >= c.cmpNum
      case '<=':
        return raw <= c.cmpNum
      case '>':
        return raw > c.cmpNum
      case '<':
        return raw < c.cmpNum
      case '=':
        return raw === c.cmpNum
      default:
        return false
    }
  }

  // eq
  const field = fieldById(catalog, fieldId)
  if (field?.type === 'multiChoice') {
    if (!Array.isArray(raw)) return false
    const want = new Set(
      c.optionIds?.length ? c.optionIds : c.value != null ? [String(c.value)] : []
    )
    if (want.size === 0) return fieldHasValue(doc, fieldId)
    return raw.some((id) => typeof id === 'string' && want.has(id))
  }
  if (field?.type === 'choice') {
    const want = new Set(
      c.optionIds?.length ? c.optionIds : c.value != null ? [String(c.value)] : []
    )
    return typeof raw === 'string' && want.has(raw)
  }
  if (field?.type === 'boolean') {
    return typeof raw === 'boolean' && c.value === raw
  }
  if (field?.type === 'number') {
    return typeof raw === 'number' && typeof c.value === 'number' && raw === c.value
  }
  // text / date / unknown — substring for text, exact for date-ish
  if (c.value == null) return fieldHasValue(doc, fieldId)
  const hay = String(raw ?? '').toLowerCase()
  const needle = String(c.value).toLowerCase()
  if (field?.type === 'date') return hay === needle
  return hay.includes(needle)
}

function clauseMatches(
  doc: UserMetadataDoc | null,
  c: MetaSearchClause,
  catalog: UserMetadataField[]
): boolean {
  const ids = c.fieldIds?.length ? c.fieldIds : [c.fieldId]
  return ids.some((id) => clauseMatchesOne(doc, c, id, catalog))
}

export function metaRecordMatches(
  doc: UserMetadataDoc | null,
  f: MetaSearchFilter,
  catalog: UserMetadataField[]
): boolean {
  const present = metaDocPresent(doc)
  if (f.hasMeta && !present) return false
  if (f.excludeHasMeta && present) return false
  for (const fid of f.fieldPresent) {
    if (!fieldHasValue(doc, fid)) return false
  }
  for (const fid of f.excludeFieldPresent) {
    if (fieldHasValue(doc, fid)) return false
  }
  for (const c of f.clauses) {
    if (!clauseMatches(doc, c, catalog)) return false
  }
  return true
}

/** Parse a meta.<key> value token into a clause given a resolved field. */
export function buildMetaClauseFromValue(
  field: UserMetadataField,
  rawVal: string
): MetaSearchClause | null {
  const t = rawVal.trim()
  if (!t) {
    return { fieldId: field.id, mode: 'present' }
  }
  if (field.type === 'number') {
    const m = /^(<=|>=|<|>)?(-?\d+(?:\.\d+)?)$/.exec(t)
    if (!m) return null
    const op = (m[1] || '=') as '>=' | '<=' | '>' | '<' | '='
    const n = Number(m[2])
    if (op === '=') return { fieldId: field.id, mode: 'eq', value: n }
    return { fieldId: field.id, mode: 'cmp', cmpOp: op, cmpNum: n }
  }
  if (field.type === 'boolean') {
    const low = t.toLowerCase()
    if (low === 'true' || low === '1' || low === 'yes') {
      return { fieldId: field.id, mode: 'eq', value: true }
    }
    if (low === 'false' || low === '0' || low === 'no') {
      return { fieldId: field.id, mode: 'eq', value: false }
    }
    return null
  }
  if (field.type === 'choice' || field.type === 'multiChoice') {
    const opt = optionByKey(field, t.toLowerCase()) ?? optionByKey(field, t)
    if (!opt) {
      const found = field.choices?.find((o) => o.key.toLowerCase() === t.toLowerCase())
      if (!found) return null
      return field.type === 'multiChoice'
        ? { fieldId: field.id, mode: 'eq', optionIds: [found.id] }
        : { fieldId: field.id, mode: 'eq', value: found.id, optionIds: [found.id] }
    }
    return field.type === 'multiChoice'
      ? { fieldId: field.id, mode: 'eq', optionIds: [opt.id] }
      : { fieldId: field.id, mode: 'eq', value: opt.id, optionIds: [opt.id] }
  }
  // text / date
  return { fieldId: field.id, mode: 'eq', value: t }
}

/**
 * Build a clause that ORs across all type-compatible fields sharing a search key.
 * Choice option keys resolve to the union of matching option ids.
 */
export function buildMetaClauseFromCompatibleFields(
  fields: UserMetadataField[],
  rawVal: string
): MetaSearchClause | null {
  if (fields.length === 0) return null
  const primary = fields[0]!
  const fieldIds = fields.map((f) => f.id)
  const t = rawVal.trim()
  if (!t) {
    return { fieldId: primary.id, fieldIds, mode: 'present' }
  }
  if (primary.type === 'choice' || primary.type === 'multiChoice') {
    const optionIds = optionIdsForSearchKey(fields, t)
    if (optionIds.length === 0) return null
    return {
      fieldId: primary.id,
      fieldIds,
      mode: 'eq',
      value: optionIds[0],
      optionIds
    }
  }
  const base = buildMetaClauseFromValue(primary, t)
  if (!base) return null
  return { ...base, fieldIds }
}

export function resolveFieldKey(
  catalog: UserMetadataField[],
  key: string
): UserMetadataField | undefined {
  const hits = fieldsBySearchKey(catalog, key)
  return hits[0]
}

export function resolveFieldKeys(
  catalog: UserMetadataField[],
  key: string
): UserMetadataField[] {
  return fieldsBySearchKey(catalog, key)
}
