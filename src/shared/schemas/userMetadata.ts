/**
 * User-defined structured metadata (D70).
 * Sets + per-folder bindings; field/option identity: opaque id · query key · name/label.
 */

import { z } from 'zod'

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

const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/
const OPTION_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/
const FIELD_ID_RE = /^mf_[a-z0-9]{6,24}$/
const OPTION_ID_RE = /^mo_[a-z0-9]{6,24}$/
const SET_ID_RE = /^ms_[a-z0-9]{6,24}$/

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
  'multiChoice'
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

export const userMetadataChoiceOptionSchema = z.object({
  id: z.string().regex(OPTION_ID_RE),
  key: z.string().regex(OPTION_KEY_RE),
  label: z.string().min(1).max(MAX_OPTION_LABEL_LEN)
})
export type UserMetadataChoiceOption = z.infer<typeof userMetadataChoiceOptionSchema>

export const userMetadataFieldSchema = z
  .object({
    id: z.string().regex(FIELD_ID_RE),
    key: z.string().regex(FIELD_KEY_RE),
    name: z.string().min(1).max(MAX_FIELD_NAME_LEN),
    type: userMetadataFieldTypeSchema,
    choices: z.array(userMetadataChoiceOptionSchema).max(MAX_CHOICE_OPTIONS).optional(),
    text: userMetadataTextConstraintsSchema.optional(),
    showAsColumn: z.boolean().catch(false)
  })
  .superRefine((f, ctx) => {
    if (f.type === 'choice' || f.type === 'multiChoice') {
      if (!f.choices || f.choices.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Choice fields need at least one option',
          path: ['choices']
        })
      } else {
        const keys = new Set<string>()
        const ids = new Set<string>()
        for (const o of f.choices) {
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
    fields: z.array(userMetadataFieldSchema).max(MAX_USER_METADATA_FIELDS).catch([])
  })
  .superRefine((set, ctx) => {
    refineFieldsUnique(set.fields, ctx, ['fields'])
  })
export type UserMetadataSet = z.infer<typeof userMetadataSetSchema>

export const userMetadataBindingSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean(),
  /** Opaque set id, or null for explicit “No metadata”. */
  setId: z.string().regex(SET_ID_RE).nullable()
})
export type UserMetadataBinding = z.infer<typeof userMetadataBindingSchema>

export const userMetadataSettingsObjectSchema = z.object({
  /** Off by default — context menu / preview / columns stay hidden until enabled. */
  enabled: z.boolean().catch(false),
  sets: z.array(userMetadataSetSchema).max(MAX_USER_METADATA_SETS).catch([]),
  bindings: z.array(userMetadataBindingSchema).max(MAX_USER_METADATA_BINDINGS).catch([])
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
  sets: [],
  bindings: []
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
  if (Array.isArray(o.sets)) {
    return {
      enabled,
      sets: o.sets as UserMetadataSet[],
      bindings: Array.isArray(o.bindings) ? (o.bindings as UserMetadataBinding[]) : []
    }
  }
  const legacyFields = Array.isArray(o.fields) ? (o.fields as UserMetadataField[]) : []
  if (legacyFields.length === 0) return { ...defaultUserMetadataSettings, enabled }
  return {
    enabled,
    sets: [
      {
        id: MIGRATED_DEFAULT_SET_ID,
        name: 'Default',
        fields: legacyFields
      }
    ],
    bindings: []
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
