import { AppError } from '@shared/result'
import {
  USER_METADATA_STREAM,
  allUserMetadataFields,
  emptyUserMetadataDoc,
  fieldById,
  parseUserMetadataDoc,
  type UserMetadataDoc,
  type UserMetadataField,
  type UserMetadataSettings
} from '@shared/schemas/userMetadata'
import { isRemoteLocation } from '@shared/remotePaths'
import { requireAbsolute } from '../fs/list'
import {
  deleteStream,
  readStreamText,
  streamExists,
  withPreservedHostTimes,
  writeStreamText
} from '../fs/adsWin32'
import { invalidateColumnMetaPaths } from '../meta/columns'
import { testWholeValueProtected } from './safeRegex'
import { getSettings } from '../settings/store'

function assertLocal(p: string): string {
  const n = requireAbsolute(p)
  if (isRemoteLocation(n)) {
    throw new AppError('not-allowed', 'User metadata is only stored on local NTFS items')
  }
  return n
}

function catalog(): UserMetadataField[] {
  const um = getSettings().userMetadata
  return um ? allUserMetadataFields(um) : []
}

async function validateValuesAgainstCatalog(
  fields: UserMetadataField[],
  values: Record<string, unknown>
): Promise<void> {
  for (const [fid, raw] of Object.entries(values)) {
    const field = fieldById(fields, fid)
    if (!field) continue // orphan ok
    if (raw == null || raw === '') continue
    if (field.type === 'text') {
      if (typeof raw !== 'string') {
        throw new AppError('validation', `${field.name}: expected text`)
      }
      const r = await testWholeValueProtected(raw, field.text?.validation, {
        minLength: field.text?.minLength,
        maxLength: field.text?.maxLength
      })
      if (!r.ok) throw new AppError('validation', `${field.name}: ${r.message}`)
    } else if (field.type === 'number') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new AppError('validation', `${field.name}: expected a number`)
      }
    } else if (field.type === 'boolean') {
      if (typeof raw !== 'boolean') {
        throw new AppError('validation', `${field.name}: expected true/false`)
      }
    } else if (field.type === 'date') {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw new AppError('validation', `${field.name}: expected YYYY-MM-DD`)
      }
    } else if (field.type === 'choice') {
      if (typeof raw !== 'string' || !field.choices?.some((o) => o.id === raw)) {
        throw new AppError('validation', `${field.name}: unknown choice`)
      }
    } else if (field.type === 'multiChoice') {
      if (!Array.isArray(raw) || !raw.every((id) => typeof id === 'string')) {
        throw new AppError('validation', `${field.name}: expected a list of options`)
      }
      const allowed = new Set(field.choices?.map((o) => o.id) ?? [])
      for (const id of raw) {
        if (!allowed.has(id)) {
          throw new AppError('validation', `${field.name}: unknown option`)
        }
      }
    }
  }
}

export async function getUserMetadataMany(
  paths: string[]
): Promise<Record<string, UserMetadataDoc | null>> {
  const out: Record<string, UserMetadataDoc | null> = {}
  if (process.platform !== 'win32') return out
  for (const raw of paths) {
    try {
      const file = requireAbsolute(raw)
      if (isRemoteLocation(file)) continue
      if (!streamExists(file, USER_METADATA_STREAM)) {
        out[raw] = null
        continue
      }
      out[raw] = parseUserMetadataDoc(await readStreamText(file, USER_METADATA_STREAM))
    } catch {
      out[raw] = null
    }
  }
  return out
}

export async function setUserMetadata(
  filePath: string,
  values: Record<string, unknown> | null,
  fieldsOverride?: UserMetadataField[]
): Promise<{ ok: true }> {
  const file = assertLocal(filePath)
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'User metadata requires NTFS alternate data streams (Windows)')
  }
  const fields = fieldsOverride ?? catalog()
  const cleaned: Record<string, unknown> = {}
  if (values) {
    for (const [k, v] of Object.entries(values)) {
      if (v == null || v === '') continue
      if (Array.isArray(v) && v.length === 0) continue
      cleaned[k] = v
    }
  }
  await validateValuesAgainstCatalog(fields, cleaned)

  const empty = Object.keys(cleaned).length === 0
  await withPreservedHostTimes(file, async () => {
    if (empty) {
      if (streamExists(file, USER_METADATA_STREAM)) {
        deleteStream(file, USER_METADATA_STREAM, { preserveHostTimes: false })
      }
    } else {
      const doc: UserMetadataDoc = {
        ...emptyUserMetadataDoc(),
        updatedAt: new Date().toISOString(),
        values: cleaned
      }
      await writeStreamText(file, USER_METADATA_STREAM, JSON.stringify(doc), false, {
        preserveHostTimes: false
      })
    }
  })
  await invalidateColumnMetaPaths([file])
  return { ok: true as const }
}

export async function setUserMetadataMany(
  paths: string[],
  values: Record<string, unknown>
): Promise<{ ok: true; done: number }> {
  const fields = catalog()
  const patchEmpty = Object.keys(values).length === 0
  let done = 0
  for (const p of paths) {
    if (patchEmpty) {
      await setUserMetadata(p, null, fields)
    } else {
      const existing = (await getUserMetadataMany([p]))[p]
      const merged: Record<string, unknown> = { ...(existing?.values ?? {}) }
      for (const [k, v] of Object.entries(values)) {
        if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) delete merged[k]
        else merged[k] = v
      }
      await setUserMetadata(p, merged, fields)
    }
    done++
  }
  return { ok: true as const, done }
}

export function getUserMetadataSettings(): UserMetadataSettings {
  return getSettings().userMetadata ?? { enabled: false, sets: [], bindings: [] }
}
