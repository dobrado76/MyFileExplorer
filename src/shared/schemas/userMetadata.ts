/**
 * User-defined structured metadata (D70).
 * Sets + per-folder bindings; field/option identity: opaque id · query key · name/label.
 */

import { z } from 'zod'
import { iconPackIdSchema } from './iconPack'

export const USER_METADATA_STREAM = 'mfe_meta'
export const USER_METADATA_FORMAT = 'MyFileExplorer.UserMetadata'
export const META_COLUMN_PREFIX = 'meta:' as const

/** Stable id when migrating legacy flat `fields[]` into one Default set. */
export const MIGRATED_DEFAULT_SET_ID = 'ms_default00000001'

export const MAX_USER_METADATA_SETS = 32
export const MAX_USER_METADATA_FIELDS = 32
export const MAX_USER_METADATA_BINDINGS = 200
export const MAX_CHOICE_OPTIONS = 32
export const MAX_FIELD_NAME_LEN = 80
export const MAX_FIELD_KEY_LEN = 64
export const MAX_OPTION_LABEL_LEN = 80
export const MAX_OPTION_KEY_LEN = 64
export const MAX_SET_NAME_LEN = 80
export const MAX_TEXT_VALUE_LEN = 4000
export const MAX_VALIDATION_PATTERN_LEN = 500
export const MAX_VALIDATION_MESSAGE_LEN = 200
export const MAX_BOOLEAN_LABEL_LEN = 40
export const DEFAULT_BOOLEAN_TRUE_LABEL = 'Yes'
export const DEFAULT_BOOLEAN_FALSE_LABEL = 'No'
/** Default glyph color for Icon tags options (matches IconPicker). */
export const DEFAULT_ICON_TAG_COLOR = '#60a5fa'
export const DEFAULT_ICON_TAG_NAME = 'Tag'

const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/
const OPTION_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/
const FIELD_ID_RE = /^mf_[a-z0-9]{6,24}$/
const OPTION_ID_RE = /^mo_[a-z0-9]{6,24}$/
const SET_ID_RE = /^ms_[a-z0-9]{6,24}$/
const ICON_COLOR_RE = /^#[0-9A-Fa-f]{6}$/

export function newUserMetadataFieldId(): string {
  return `mf_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export function newUserMetadataOptionId(): string {
  return `mo_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export function newUserMetadataSetId(): string {
  return `ms_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export const userMetadataFieldTypeSchema = z.enum([
  'text',
  'number',
  'boolean',
  'date',
  'choice',
  'multiChoice',
  /** http(s) URL, absolute path, or path relative to the item. */
  'link',
  /** Multi-select visual tags (glyph per option). ADS = option id[]. */
  'iconTags'
])
export type UserMetadataFieldType = z.infer<typeof userMetadataFieldTypeSchema>

export const userMetadataTextValidationSchema = z.object({
  pattern: z.string().min(1).max(MAX_VALIDATION_PATTERN_LEN),
  flags: z.enum(['', 'i']).catch(''),
  message: z.string().max(MAX_VALIDATION_MESSAGE_LEN).optional()
})
export type UserMetadataTextValidation = z.infer<typeof userMetadataTextValidationSchema>

export const userMetadataTextConstraintsSchema = z.object({
  minLength: z.number().int().min(0).max(MAX_TEXT_VALUE_LEN).optional(),
  maxLength: z.number().int().min(1).max(MAX_TEXT_VALUE_LEN).optional(),
  validation: userMetadataTextValidationSchema.optional()
})

/** Display labels for boolean fields (ADS still stores true/false). Missing ⇒ Yes / No. */
export const userMetadataBooleanLabelsSchema = z.object({
  trueLabel: z
    .string()
    .min(1)
    .max(MAX_BOOLEAN_LABEL_LEN)
    .catch(DEFAULT_BOOLEAN_TRUE_LABEL),
  falseLabel: z
    .string()
    .min(1)
    .max(MAX_BOOLEAN_LABEL_LEN)
    .catch(DEFAULT_BOOLEAN_FALSE_LABEL)
})
export type UserMetadataBooleanLabels = z.infer<typeof userMetadataBooleanLabelsSchema>

export const userMetadataChoiceOptionSchema = z.object({
  id: z.string().regex(OPTION_ID_RE),
  key: z.string().regex(OPTION_KEY_RE),
  label: z.string().min(1).max(MAX_OPTION_LABEL_LEN),
  /** Glyph for iconTags (optional on choice/multiChoice). */
  lucideName: z.string().min(1).max(80).optional(),
  lucideColor: z.string().regex(ICON_COLOR_RE).optional(),
  lucidePack: iconPackIdSchema
})
export type UserMetadataChoiceOption = z.infer<typeof userMetadataChoiceOptionSchema>

export function defaultIconTagOptionGlyph(): Pick<
  UserMetadataChoiceOption,
  'lucideName' | 'lucideColor'
> {
  return { lucideName: DEFAULT_ICON_TAG_NAME, lucideColor: DEFAULT_ICON_TAG_COLOR }
}

export function iconTagOptionColor(option: Pick<UserMetadataChoiceOption, 'lucideColor'>): string {
  const c = option.lucideColor?.trim()
  return c && ICON_COLOR_RE.test(c) ? c : DEFAULT_ICON_TAG_COLOR
}

/** True for types that use the shared choices[] option catalog. */
export function fieldUsesChoiceOptions(type: UserMetadataFieldType): boolean {
  return type === 'choice' || type === 'multiChoice' || type === 'iconTags'
}

/** True for types whose ADS value is string[] of option ids. */
export function fieldUsesMultiOptionIds(type: UserMetadataFieldType): boolean {
  return type === 'multiChoice' || type === 'iconTags'
}

export const userMetadataFieldSchema = z
  .object({
    id: z.string().regex(FIELD_ID_RE),
    key: z.string().regex(FIELD_KEY_RE),
    name: z.string().min(1).max(MAX_FIELD_NAME_LEN),
    type: userMetadataFieldTypeSchema,
    choices: z.array(userMetadataChoiceOptionSchema).max(MAX_CHOICE_OPTIONS).optional(),
    text: userMetadataTextConstraintsSchema.optional(),
    /** Labels for type boolean; omitted ⇒ Yes / No. */
    boolean: userMetadataBooleanLabelsSchema.optional(),
    showAsColumn: z.boolean().catch(false),
    /**
     * Editing constraint (not a population guarantee):
     * Set / single-item Save need a non-empty value; Clear is unavailable;
     * Leave is allowed (including legacy items that still lack a value).
     */
    required: z.boolean().catch(false),
    /**
     * Seeded into Metadata… when the item has no value for this field.
     * Not written until the user saves.
     */
    defaultValue: z
      .union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])
      .optional(),
    /** At most one field per set; drives icon-row badge. */
    showOnIcon: z.boolean().catch(false),
    /** Preferred Details column width (px). */
    columnWidthHint: z.number().int().min(60).max(480).optional()
  })
  .superRefine((f, ctx) => {
    if (fieldUsesChoiceOptions(f.type)) {
      if (!f.choices || f.choices.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            f.type === 'iconTags'
              ? 'Icon tags need at least one option'
              : 'Choice fields need at least one option',
          path: ['choices']
        })
      } else {
        const keys = new Set<string>()
        const ids = new Set<string>()
        for (let oi = 0; oi < f.choices.length; oi++) {
          const o = f.choices[oi]!
          if (keys.has(o.key)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate option key: ${o.key}`,
              path: ['choices']
            })
          }
          keys.add(o.key)
          if (ids.has(o.id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate option id: ${o.id}`,
              path: ['choices']
            })
          }
          ids.add(o.id)
          if (f.type === 'iconTags' && !o.lucideName?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Icon tag options need an icon',
              path: ['choices', oi, 'lucideName']
            })
          }
        }
      }
    }
    if (f.type === 'text' && f.text?.minLength != null && f.text.maxLength != null) {
      if (f.text.minLength > f.text.maxLength) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'minLength cannot exceed maxLength',
          path: ['text', 'minLength']
        })
      }
    }
  })
export type UserMetadataField = z.infer<typeof userMetadataFieldSchema>

/**
 * Details column encoding for iconTags: `mo_aaa:1;mo_bbb:0;…` (catalog order).
 */
export function formatIconTagsColumnValue(
  field: Pick<UserMetadataField, 'choices'>,
  selectedIds: string[]
): string {
  const on = new Set(selectedIds)
  return (field.choices ?? [])
    .map((o) => `${o.id}:${on.has(o.id) ? '1' : '0'}`)
    .join(';')
}

export function parseIconTagsColumnValue(raw: string): { id: string; on: boolean }[] {
  if (!raw.trim()) return []
  const out: { id: string; on: boolean }[] = []
  for (const part of raw.split(';')) {
    const t = part.trim()
    if (!t) continue
    const colon = t.lastIndexOf(':')
    if (colon <= 0) continue
    const id = t.slice(0, colon)
    const flag = t.slice(colon + 1)
    if (!OPTION_ID_RE.test(id)) continue
    out.push({ id, on: flag === '1' })
  }
  return out
}

function refineFieldsUnique(
  fields: UserMetadataField[],
  ctx: z.RefinementCtx,
  pathPrefix: (string | number)[]
): void {
  const keys = new Set<string>()
  const ids = new Set<string>()
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!
    if (keys.has(f.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate field key: ${f.key}`,
        path: [...pathPrefix, i, 'key']
      })
    }
    keys.add(f.key)
    if (ids.has(f.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate field id: ${f.id}`,
        path: [...pathPrefix, i, 'id']
      })
    }
    ids.add(f.id)
  }
}

export const userMetadataSetSchema = z
  .object({
    id: z.string().regex(SET_ID_RE),
    name: z.string().min(1).max(MAX_SET_NAME_LEN),
    /**
     * Soft-parse: keep valid fields, drop invalid ones.
     * Never use `.catch([])` here — one bad field must not wipe the catalog.
     */
    fields: z.preprocess(
      sanitizeUserMetadataFields,
      z.array(userMetadataFieldSchema).max(MAX_USER_METADATA_FIELDS)
    )
  })
  .superRefine((set, ctx) => {
    refineFieldsUnique(set.fields, ctx, ['fields'])
    const iconBadge = set.fields.filter((f) => f.showOnIcon === true)
    if (iconBadge.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At most one field per set can show on icons',
        path: ['fields']
      })
    }
  })
export type UserMetadataSet = z.infer<typeof userMetadataSetSchema>

export const userMetadataBindingSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean(),
  /** Opaque set id, or null for explicit “No metadata”. */
  setId: z.string().regex(SET_ID_RE).nullable()
})
export type UserMetadataBinding = z.infer<typeof userMetadataBindingSchema>

/** Drop invalid bindings; never wipe the whole list because of one bad row. */
export function sanitizeUserMetadataBindings(raw: unknown): UserMetadataBinding[] {
  if (!Array.isArray(raw)) return []
  const out: UserMetadataBinding[] = []
  for (const item of raw) {
    const p = userMetadataBindingSchema.safeParse(item)
    if (!p.success) continue
    out.push(p.data)
    if (out.length >= MAX_USER_METADATA_BINDINGS) break
  }
  return out
}

/**
 * Keep valid fields only. Used so schema evolution / one bad row cannot
 * empty an entire set (the old `.catch([])` on the fields array did that).
 */
export function sanitizeUserMetadataFields(raw: unknown): UserMetadataField[] {
  if (!Array.isArray(raw)) return []
  const out: UserMetadataField[] = []
  const seenIds = new Set<string>()
  const seenKeys = new Set<string>()
  for (const item of raw) {
    const p = userMetadataFieldSchema.safeParse(item)
    if (!p.success) continue
    if (seenIds.has(p.data.id) || seenKeys.has(p.data.key)) continue
    seenIds.add(p.data.id)
    seenKeys.add(p.data.key)
    out.push(p.data)
    if (out.length >= MAX_USER_METADATA_FIELDS) break
  }
  return out
}

/** Soft-parse sets; invalid sets dropped, fields inside sanitized. */
export function sanitizeUserMetadataSets(raw: unknown): UserMetadataSet[] {
  if (!Array.isArray(raw)) return []
  const out: UserMetadataSet[] = []
  const seenIds = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (!SET_ID_RE.test(id) || !name || seenIds.has(id)) continue
    seenIds.add(id)
    out.push({
      id,
      name: name.slice(0, MAX_SET_NAME_LEN),
      fields: sanitizeUserMetadataFields(o.fields)
    })
    if (out.length >= MAX_USER_METADATA_SETS) break
  }
  return out
}

/** Cap retained catalog tombstones (recovery / pack / Hygiene only). */
export const MAX_DELETED_FIELD_IDENTITIES = 256
export const MAX_DELETED_OPTION_IDENTITIES = 512

/** Hidden recovery row after a field definition is deleted. */
export const deletedFieldIdentitySchema = z.object({
  id: z.string().regex(FIELD_ID_RE),
  formerKey: z.string().regex(FIELD_KEY_RE),
  type: userMetadataFieldTypeSchema
})
export type DeletedFieldIdentity = z.infer<typeof deletedFieldIdentitySchema>

/** Hidden recovery row after a choice / multi-choice / icon-tag option is deleted. */
export const deletedOptionIdentitySchema = z.object({
  id: z.string().regex(OPTION_ID_RE),
  fieldId: z.string().regex(FIELD_ID_RE),
  formerKey: z.string().regex(OPTION_KEY_RE)
})
export type DeletedOptionIdentity = z.infer<typeof deletedOptionIdentitySchema>

export const deletedIdentitiesSchema = z.object({
  fields: z.array(deletedFieldIdentitySchema).max(MAX_DELETED_FIELD_IDENTITIES),
  options: z.array(deletedOptionIdentitySchema).max(MAX_DELETED_OPTION_IDENTITIES)
})
export type DeletedIdentities = z.infer<typeof deletedIdentitiesSchema>

export function emptyDeletedIdentities(): DeletedIdentities {
  return { fields: [], options: [] }
}

export function sanitizeDeletedIdentities(raw: unknown): DeletedIdentities {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyDeletedIdentities()
  const o = raw as Record<string, unknown>
  const fields: DeletedFieldIdentity[] = []
  const options: DeletedOptionIdentity[] = []
  if (Array.isArray(o.fields)) {
    const seen = new Set<string>()
    for (const item of o.fields) {
      const p = deletedFieldIdentitySchema.safeParse(item)
      if (!p.success || seen.has(p.data.id)) continue
      seen.add(p.data.id)
      fields.push(p.data)
      if (fields.length >= MAX_DELETED_FIELD_IDENTITIES) break
    }
  }
  if (Array.isArray(o.options)) {
    const seen = new Set<string>()
    for (const item of o.options) {
      const p = deletedOptionIdentitySchema.safeParse(item)
      if (!p.success || seen.has(p.data.id)) continue
      seen.add(p.data.id)
      options.push(p.data)
      if (options.length >= MAX_DELETED_OPTION_IDENTITIES) break
    }
  }
  return { fields, options }
}

/** Drop tombstones whose ids are live again in the catalog. */
export function pruneDeletedIdentities(
  di: DeletedIdentities,
  settings: { sets: UserMetadataSet[] }
): DeletedIdentities {
  const liveFields = new Set<string>()
  const liveOptions = new Set<string>()
  for (const set of settings.sets) {
    for (const f of set.fields) {
      liveFields.add(f.id)
      for (const o of f.choices ?? []) liveOptions.add(o.id)
    }
  }
  return {
    fields: di.fields.filter((t) => !liveFields.has(t.id)).slice(0, MAX_DELETED_FIELD_IDENTITIES),
    options: di.options.filter((t) => !liveOptions.has(t.id)).slice(0, MAX_DELETED_OPTION_IDENTITIES)
  }
}

function pushUniqueFieldTombstone(
  list: DeletedFieldIdentity[],
  row: DeletedFieldIdentity
): DeletedFieldIdentity[] {
  const next = [{ ...row }, ...list.filter((t) => t.id !== row.id)]
  return next.slice(0, MAX_DELETED_FIELD_IDENTITIES)
}

function pushUniqueOptionTombstone(
  list: DeletedOptionIdentity[],
  row: DeletedOptionIdentity
): DeletedOptionIdentity[] {
  const next = [{ ...row }, ...list.filter((t) => t.id !== row.id)]
  return next.slice(0, MAX_DELETED_OPTION_IDENTITIES)
}

/** Record a removed field (+ its options) for Hygiene / pack recovery. */
export function recordDeletedField(
  di: DeletedIdentities,
  field: Pick<UserMetadataField, 'id' | 'key' | 'type' | 'choices'>
): DeletedIdentities {
  const fields = pushUniqueFieldTombstone(di.fields, {
    id: field.id,
    formerKey: field.key,
    type: field.type
  })
  let options = di.options
  for (const o of field.choices ?? []) {
    options = pushUniqueOptionTombstone(options, {
      id: o.id,
      fieldId: field.id,
      formerKey: o.key
    })
  }
  return { fields, options }
}

/** Record a removed choice-like option. */
export function recordDeletedOption(
  di: DeletedIdentities,
  fieldId: string,
  option: Pick<UserMetadataChoiceOption, 'id' | 'key'>
): DeletedIdentities {
  return {
    fields: di.fields,
    options: pushUniqueOptionTombstone(di.options, {
      id: option.id,
      fieldId,
      formerKey: option.key
    })
  }
}

/** Tombstone every field/option in a deleted set. */
export function recordDeletedSet(
  di: DeletedIdentities,
  set: Pick<UserMetadataSet, 'fields'>
): DeletedIdentities {
  let next = di
  for (const f of set.fields) next = recordDeletedField(next, f)
  return next
}

export function lookupDeletedField(
  di: DeletedIdentities | undefined,
  fieldId: string
): DeletedFieldIdentity | undefined {
  return di?.fields.find((t) => t.id === fieldId)
}

export function lookupDeletedOptionKey(
  di: DeletedIdentities | undefined,
  optionId: string
): string | undefined {
  return di?.options.find((t) => t.id === optionId)?.formerKey
}

export const userMetadataSettingsObjectSchema = z.object({
  /** Off by default — context menu / preview / columns stay hidden until enabled. */
  enabled: z.boolean().catch(false),
  /** Optional toolbar button opening the Metadata manager (left of Script Manager). */
  showToolbarButton: z.boolean().catch(false),
  sets: z.preprocess(
    sanitizeUserMetadataSets,
    z.array(userMetadataSetSchema).max(MAX_USER_METADATA_SETS)
  ),
  bindings: z.preprocess(
    sanitizeUserMetadataBindings,
    z.array(userMetadataBindingSchema).max(MAX_USER_METADATA_BINDINGS)
  ),
  /**
   * Lightweight catalog tombstones for Hygiene reconnect / pack identity recovery.
   * Hidden from ordinary UI; never written into ADS values.
   */
  deletedIdentities: z.preprocess(sanitizeDeletedIdentities, deletedIdentitiesSchema).optional()
})

/** Full settings parse — cross-set key/type compat, global field ids, binding refs. */
export const userMetadataSettingsSchema = userMetadataSettingsObjectSchema.superRefine((s, ctx) => {
  const setIds = new Set<string>()
  const globalFieldIds = new Set<string>()
  /** key → type of first field seen with that key */
  const keyTypes = new Map<string, UserMetadataFieldType>()

  for (let si = 0; si < s.sets.length; si++) {
    const set = s.sets[si]!
    if (setIds.has(set.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate set id: ${set.id}`,
        path: ['sets', si, 'id']
      })
    }
    setIds.add(set.id)
    for (let fi = 0; fi < set.fields.length; fi++) {
      const f = set.fields[fi]!
      if (globalFieldIds.has(f.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate field id across sets: ${f.id}`,
          path: ['sets', si, 'fields', fi, 'id']
        })
      }
      globalFieldIds.add(f.id)
      const prev = keyTypes.get(f.key)
      if (prev != null && prev !== f.type) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Field key “${f.key}” is used as ${prev} and ${f.type}; types must match across sets`,
          path: ['sets', si, 'fields', fi, 'key']
        })
      } else if (prev == null) {
        keyTypes.set(f.key, f.type)
      }
    }
  }

  for (let bi = 0; bi < s.bindings.length; bi++) {
    const b = s.bindings[bi]!
    if (b.setId != null && !setIds.has(b.setId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Binding references unknown set: ${b.setId}`,
        path: ['bindings', bi, 'setId']
      })
    }
  }
})

export type UserMetadataSettings = z.infer<typeof userMetadataSettingsObjectSchema>

export const defaultUserMetadataSettings: UserMetadataSettings = {
  enabled: false,
  showToolbarButton: false,
  sets: [],
  bindings: [],
  deletedIdentities: emptyDeletedIdentities()
}

/**
 * Normalize raw settings (incl. legacy `{ fields }`) into sets + bindings.
 * Empty legacy catalog → empty sets (nothing shows until bound).
 * `enabled` defaults false (opt-in).
 */
export function migrateUserMetadataSettings(raw: unknown): UserMetadataSettings {
  if (!raw || typeof raw !== 'object') return { ...defaultUserMetadataSettings }
  const o = raw as Record<string, unknown>
  const enabled = typeof o.enabled === 'boolean' ? o.enabled : false
  const showToolbarButton = typeof o.showToolbarButton === 'boolean' ? o.showToolbarButton : false
  const rawTombstones = sanitizeDeletedIdentities(o.deletedIdentities)
  if (Array.isArray(o.sets)) {
    const sets = sanitizeUserMetadataSets(o.sets)
    return {
      enabled,
      showToolbarButton,
      sets,
      bindings: sanitizeUserMetadataBindings(o.bindings),
      deletedIdentities: pruneDeletedIdentities(rawTombstones, { sets })
    }
  }
  const legacyFields = sanitizeUserMetadataFields(o.fields)
  if (legacyFields.length === 0) {
    return { ...defaultUserMetadataSettings, enabled, showToolbarButton }
  }
  const sets = [
    {
      id: MIGRATED_DEFAULT_SET_ID,
      name: 'Default',
      fields: legacyFields
    }
  ]
  return {
    enabled,
    showToolbarButton,
    sets,
    bindings: [],
    deletedIdentities: pruneDeletedIdentities(rawTombstones, { sets })
  }
}

/** On-item ADS document (values keyed by opaque field id). */
export const userMetadataDocSchema = z.object({
  format: z.literal(USER_METADATA_FORMAT).catch(USER_METADATA_FORMAT),
  version: z.literal(1).catch(1),
  updatedAt: z.string().catch(() => new Date().toISOString()),
  values: z.record(z.string(), z.unknown()).catch({})
})
export type UserMetadataDoc = z.infer<typeof userMetadataDocSchema>

export type UserMetadataValue =
  | string
  | number
  | boolean
  | string[] // multiChoice option ids
  | null

export function parseUserMetadataDoc(raw: string): UserMetadataDoc | null {
  try {
    const parsed = userMetadataDocSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function emptyUserMetadataDoc(): UserMetadataDoc {
  return {
    format: USER_METADATA_FORMAT,
    version: 1,
    updatedAt: new Date().toISOString(),
    values: {}
  }
}

export function isMetaColumnId(id: string): boolean {
  return id.startsWith(META_COLUMN_PREFIX) && id.length > META_COLUMN_PREFIX.length
}

export function metaColumnId(fieldId: string): string {
  return `${META_COLUMN_PREFIX}${fieldId}`
}

export function parseMetaColumnFieldId(columnId: string): string | null {
  if (!isMetaColumnId(columnId)) return null
  const id = columnId.slice(META_COLUMN_PREFIX.length)
  return FIELD_ID_RE.test(id) ? id : null
}

export function allUserMetadataFields(settings: UserMetadataSettings): UserMetadataField[] {
  return settings.sets.flatMap((s) => s.fields)
}

export function setById(
  settings: UserMetadataSettings,
  id: string
): UserMetadataSet | undefined {
  return settings.sets.find((s) => s.id === id)
}

export function fieldById(
  fields: UserMetadataField[],
  id: string
): UserMetadataField | undefined {
  return fields.find((f) => f.id === id)
}

export function fieldByIdInSettings(
  settings: UserMetadataSettings,
  id: string
): UserMetadataField | undefined {
  for (const set of settings.sets) {
    const f = fieldById(set.fields, id)
    if (f) return f
  }
  return undefined
}

export function fieldByKey(
  fields: UserMetadataField[],
  key: string
): UserMetadataField | undefined {
  return fields.find((f) => f.key === key)
}

export function defaultBooleanLabels(): UserMetadataBooleanLabels {
  return { trueLabel: DEFAULT_BOOLEAN_TRUE_LABEL, falseLabel: DEFAULT_BOOLEAN_FALSE_LABEL }
}

/** Display labels for a boolean field (ADS still stores true/false). Missing ⇒ Yes / No. */
export function booleanFieldLabels(
  field: Pick<UserMetadataField, 'boolean'>
): UserMetadataBooleanLabels {
  const t = field.boolean?.trueLabel?.trim()
  const f = field.boolean?.falseLabel?.trim()
  return {
    trueLabel: t || DEFAULT_BOOLEAN_TRUE_LABEL,
    falseLabel: f || DEFAULT_BOOLEAN_FALSE_LABEL
  }
}

/** Format a stored boolean for columns / read-only UI. */
export function formatBooleanFieldValue(
  field: Pick<UserMetadataField, 'boolean'>,
  value: boolean
): string {
  const labels = booleanFieldLabels(field)
  return value ? labels.trueLabel : labels.falseLabel
}

/**
 * Resolve a Power Search / typed token to a boolean.
 * Always accepts true/false/1/0/yes/no; also the field’s configured labels.
 */
export function parseBooleanFieldToken(
  field: Pick<UserMetadataField, 'boolean'>,
  raw: string
): boolean | null {
  const low = raw.trim().toLowerCase()
  if (!low) return null
  if (low === 'true' || low === '1' || low === 'yes') return true
  if (low === 'false' || low === '0' || low === 'no') return false
  const labels = booleanFieldLabels(field)
  if (low === labels.trueLabel.toLowerCase()) return true
  if (low === labels.falseLabel.toLowerCase()) return false
  return null
}

/** All fields sharing a query key (must be type-compatible when settings validated). */
export function fieldsBySearchKey(
  catalog: UserMetadataField[],
  key: string
): UserMetadataField[] {
  const low = key.toLowerCase()
  return catalog.filter((f) => f.key === key || f.key.toLowerCase() === low)
}

export function optionByKey(
  field: UserMetadataField,
  key: string
): UserMetadataChoiceOption | undefined {
  return field.choices?.find((o) => o.key === key)
}

export function optionById(
  field: UserMetadataField,
  id: string
): UserMetadataChoiceOption | undefined {
  return field.choices?.find((o) => o.id === id)
}

/** Option ids across type-compatible fields for a shared option key. */
export function optionIdsForSearchKey(
  fields: UserMetadataField[],
  optionKey: string
): string[] {
  const low = optionKey.toLowerCase()
  const ids: string[] = []
  for (const f of fields) {
    const opt =
      optionByKey(f, optionKey) ??
      f.choices?.find((o) => o.key.toLowerCase() === low)
    if (opt) ids.push(opt.id)
  }
  return ids
}

/** Suggest a unique key from a display name (for new fields only — never rename id). */
export function suggestFieldKey(name: string, taken: Set<string>): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
  if (!/^[a-z]/.test(base)) base = `f_${base || 'field'}`
  base = base.slice(0, MAX_FIELD_KEY_LEN)
  if (!FIELD_KEY_RE.test(base)) base = 'field'
  let key = base
  let n = 2
  while (taken.has(key)) {
    const suffix = `_${n++}`
    key = (base.slice(0, MAX_FIELD_KEY_LEN - suffix.length) + suffix).slice(0, MAX_FIELD_KEY_LEN)
  }
  return key
}
