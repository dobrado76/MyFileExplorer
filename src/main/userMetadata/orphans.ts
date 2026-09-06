/**
 * Orphan hygiene — scan / clear / reconnect leftover mfe_meta keys (D70 AAA #2).
 */
import { AppError } from '@shared/result'
import {
  USER_METADATA_STREAM,
  allUserMetadataFields,
  emptyUserMetadataDoc,
  fieldById,
  fieldUsesChoiceOptions,
  fieldUsesMultiOptionIds,
  lookupDeletedField,
  lookupDeletedOptionKey,
  optionById,
  parseUserMetadataDoc,
  sanitizeDeletedIdentities,
  type DeletedIdentities,
  type UserMetadataDoc,
  type UserMetadataField
} from '@shared/schemas/userMetadata'
import type {
  UserMetadataOrphan,
  UserMetadataOrphanClearResult,
  UserMetadataOrphanReconnectMapping,
  UserMetadataOrphanReconnectResult,
  UserMetadataOrphanScanResult
} from '@shared/userMetadataOrphans'
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
import { getSettings } from '../settings/store'
import { walkUserMetadataHosts } from './walk'

function catalog(): UserMetadataField[] {
  const um = getSettings().userMetadata
  return um ? allUserMetadataFields(um) : []
}

function tombstones(): DeletedIdentities {
  const um = getSettings().userMetadata
  return sanitizeDeletedIdentities(um?.deletedIdentities)
}

function assertLocalFolder(folderPath: string): string {
  const n = requireAbsolute(folderPath)
  if (isRemoteLocation(n)) {
    throw new AppError('not-allowed', 'User metadata orphans scan requires a local folder')
  }
  return n
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AppError('cancelled', 'Orphan scan cancelled')
  }
}

function collectOrphansForDoc(
  hostPath: string,
  doc: UserMetadataDoc,
  fields: UserMetadataField[]
): UserMetadataOrphan[] {
  const out: UserMetadataOrphan[] = []
  for (const [fieldId, raw] of Object.entries(doc.values)) {
    const field = fieldById(fields, fieldId)
    if (!field) {
      out.push({ path: hostPath, kind: 'field', fieldId })
      continue
    }
    if (!fieldUsesChoiceOptions(field.type)) continue
    const allowed = new Set(field.choices?.map((o) => o.id) ?? [])
    if (fieldUsesMultiOptionIds(field.type)) {
      if (!Array.isArray(raw)) continue
      for (const id of raw) {
        if (typeof id !== 'string' || allowed.has(id)) continue
        out.push({
          path: hostPath,
          kind: 'option',
          fieldId,
          optionId: id,
          keyGuess: field.key
        })
      }
    } else if (typeof raw === 'string' && raw && !allowed.has(raw)) {
      out.push({
        path: hostPath,
        kind: 'option',
        fieldId,
        optionId: raw,
        keyGuess: field.key
      })
    }
  }
  return out
}

export async function scanUserMetadataOrphans(opts?: {
  folderPath?: string
  signal?: AbortSignal
}): Promise<UserMetadataOrphanScanResult> {
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'User metadata requires NTFS alternate data streams (Windows)')
  }
  let folder = opts?.folderPath
  if (!folder) {
    const { BrowserWindow, dialog } = await import('electron')
    const win = BrowserWindow.getFocusedWindow()
    const pick = win
      ? await dialog.showOpenDialog(win, {
          title: 'Scan orphan metadata — choose folder',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({
          title: 'Scan orphan metadata — choose folder',
          properties: ['openDirectory']
        })
    if (pick.canceled || !pick.filePaths[0]) {
      throw new AppError('cancelled', 'Scan cancelled')
    }
    folder = pick.filePaths[0]
  }
  const root = assertLocalFolder(folder)
  const fields = catalog()
  const hosts = await walkUserMetadataHosts(root, { signal: opts?.signal })
  const orphans: UserMetadataOrphan[] = []
  for (const host of hosts) {
    throwIfAborted(opts?.signal)
    try {
      if (isRemoteLocation(host)) continue
      if (!streamExists(host, USER_METADATA_STREAM)) continue
      const doc = parseUserMetadataDoc(await readStreamText(host, USER_METADATA_STREAM))
      if (!doc || Object.keys(doc.values).length === 0) continue
      orphans.push(...collectOrphansForDoc(host, doc, fields))
    } catch (e) {
      if (e instanceof AppError && e.code === 'cancelled') throw e
      /* soft */
    }
  }
  return { orphans }
}

function stripOrphansFromValues(
  values: Record<string, unknown>,
  orphansForPath: UserMetadataOrphan[],
  fields: UserMetadataField[]
): { next: Record<string, unknown>; removed: number } {
  const fieldOrphans = new Set(
    orphansForPath.filter((o) => o.kind === 'field').map((o) => o.fieldId)
  )
  const optionOrphans = new Map<string, Set<string>>()
  for (const o of orphansForPath) {
    if (o.kind !== 'option' || !o.optionId) continue
    let set = optionOrphans.get(o.fieldId)
    if (!set) {
      set = new Set()
      optionOrphans.set(o.fieldId, set)
    }
    set.add(o.optionId)
  }

  const next: Record<string, unknown> = { ...values }
  let removed = 0

  for (const fid of fieldOrphans) {
    if (fid in next) {
      delete next[fid]
      removed++
    }
  }

  for (const [fid, optIds] of optionOrphans) {
    if (fieldOrphans.has(fid)) continue
    if (!(fid in next)) continue
    const field = fieldById(fields, fid)
    const raw = next[fid]
    if (field && fieldUsesMultiOptionIds(field.type) && Array.isArray(raw)) {
      const filtered = raw.filter((id) => typeof id === 'string' && !optIds.has(id))
      removed += raw.length - filtered.length
      if (filtered.length === 0) delete next[fid]
      else next[fid] = filtered
    } else if (typeof raw === 'string' && optIds.has(raw)) {
      delete next[fid]
      removed++
    }
  }

  return { next, removed }
}

async function writeDocOrDelete(
  hostPath: string,
  values: Record<string, unknown>
): Promise<void> {
  const empty = Object.keys(values).length === 0
  await withPreservedHostTimes(hostPath, async () => {
    if (empty) {
      if (streamExists(hostPath, USER_METADATA_STREAM)) {
        deleteStream(hostPath, USER_METADATA_STREAM, { preserveHostTimes: false })
      }
    } else {
      const doc: UserMetadataDoc = {
        ...emptyUserMetadataDoc(),
        updatedAt: new Date().toISOString(),
        values
      }
      await writeStreamText(hostPath, USER_METADATA_STREAM, JSON.stringify(doc), false, {
        preserveHostTimes: false
      })
    }
  })
}

export async function clearUserMetadataOrphans(opts: {
  paths?: string[]
  orphans: UserMetadataOrphan[]
}): Promise<UserMetadataOrphanClearResult> {
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'User metadata requires NTFS alternate data streams (Windows)')
  }
  const fields = catalog()
  const pathFilter = opts.paths?.length ? new Set(opts.paths.map((p) => requireAbsolute(p))) : null
  const byPath = new Map<string, UserMetadataOrphan[]>()
  for (const o of opts.orphans) {
    const p = requireAbsolute(o.path)
    if (pathFilter && !pathFilter.has(p)) continue
    const list = byPath.get(p) ?? []
    list.push({ ...o, path: p })
    byPath.set(p, list)
  }

  let cleared = 0
  const touched: string[] = []
  for (const [hostPath, list] of byPath) {
    try {
      if (isRemoteLocation(hostPath)) continue
      if (!streamExists(hostPath, USER_METADATA_STREAM)) continue
      const doc = parseUserMetadataDoc(await readStreamText(hostPath, USER_METADATA_STREAM))
      if (!doc) continue
      const { next, removed } = stripOrphansFromValues(doc.values, list, fields)
      if (removed === 0) continue
      await writeDocOrDelete(hostPath, next)
      cleared += removed
      touched.push(hostPath)
    } catch {
      /* soft */
    }
  }
  if (touched.length) await invalidateColumnMetaPaths(touched)
  return { ok: true as const, cleared }
}

function valueCompatibleWithField(field: UserMetadataField, raw: unknown): boolean {
  if (raw == null || raw === '') return false
  switch (field.type) {
    case 'text':
    case 'date':
    case 'link':
      return typeof raw === 'string'
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw)
    case 'boolean':
      return typeof raw === 'boolean'
    case 'choice':
      return typeof raw === 'string'
    case 'multiChoice':
    case 'iconTags':
      return Array.isArray(raw) && raw.every((id) => typeof id === 'string')
    default:
      return false
  }
}

/** Map option ids via live catalog, then deletedIdentities tombstones (former keys). */
function remapOptionIds(
  fields: UserMetadataField[],
  di: DeletedIdentities,
  fromField: UserMetadataField | undefined,
  toField: UserMetadataField,
  raw: unknown
): unknown {
  if (!fieldUsesChoiceOptions(toField.type)) return raw

  const resolveKey = (optionId: string): string | undefined => {
    if (fromField) {
      const o = optionById(fromField, optionId)
      if (o) return o.key
    }
    for (const f of fields) {
      if (!fieldUsesChoiceOptions(f.type)) continue
      const o = optionById(f, optionId)
      if (o) return o.key
    }
    return lookupDeletedOptionKey(di, optionId)
  }

  const mapOne = (optionId: string): string | null => {
    if (toField.choices?.some((o) => o.id === optionId)) return optionId
    const key = resolveKey(optionId)
    if (!key) return null
    const dest = toField.choices?.find((o) => o.key === key)
    return dest?.id ?? null
  }

  if (fieldUsesMultiOptionIds(toField.type)) {
    if (!Array.isArray(raw)) return []
    const out: string[] = []
    const seen = new Set<string>()
    for (const id of raw) {
      if (typeof id !== 'string') continue
      const mapped = mapOne(id)
      if (!mapped || seen.has(mapped)) continue
      seen.add(mapped)
      out.push(mapped)
    }
    return out
  }

  if (typeof raw !== 'string') return raw
  return mapOne(raw) ?? raw
}

export async function reconnectUserMetadataOrphans(opts: {
  mappings: UserMetadataOrphanReconnectMapping[]
}): Promise<UserMetadataOrphanReconnectResult> {
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'User metadata requires NTFS alternate data streams (Windows)')
  }
  const fields = catalog()
  const di = tombstones()
  let remapped = 0
  const touched: string[] = []

  // Group by path so we rewrite each doc once
  const byPath = new Map<string, UserMetadataOrphanReconnectMapping[]>()
  for (const m of opts.mappings) {
    const p = requireAbsolute(m.path)
    const list = byPath.get(p) ?? []
    list.push({ ...m, path: p })
    byPath.set(p, list)
  }

  for (const [hostPath, maps] of byPath) {
    try {
      if (isRemoteLocation(hostPath)) continue
      if (!streamExists(hostPath, USER_METADATA_STREAM)) continue
      const doc = parseUserMetadataDoc(await readStreamText(hostPath, USER_METADATA_STREAM))
      if (!doc) continue
      const values: Record<string, unknown> = { ...doc.values }
      let changed = false

      for (const m of maps) {
        if (!(m.fromFieldId in values)) continue
        const toField = fieldById(fields, m.toFieldId)
        if (!toField) continue
        const fromField = fieldById(fields, m.fromFieldId)
        const fromTomb = lookupDeletedField(di, m.fromFieldId)
        if (fromField) {
          if (fromField.key !== toField.key || fromField.type !== toField.type) continue
        } else if (fromTomb) {
          if (fromTomb.formerKey !== toField.key || fromTomb.type !== toField.type) continue
        }
        // No live field and no tombstone: still allow reconnect when the user picks a target key,
        // but option ids can only remap via tombstones / live catalog — never invent keys from ADS.
        const raw = values[m.fromFieldId]
        if (!valueCompatibleWithField(toField, raw)) continue

        const remappedVal = remapOptionIds(fields, di, fromField, toField, raw)
        if (
          fieldUsesMultiOptionIds(toField.type) &&
          Array.isArray(remappedVal) &&
          remappedVal.length === 0
        ) {
          // Nothing usable — leave orphan as-is
          continue
        }
        if (
          toField.type === 'choice' &&
          typeof remappedVal === 'string' &&
          !toField.choices?.some((o) => o.id === remappedVal)
        ) {
          continue
        }

        if (m.fromFieldId === m.toFieldId) {
          values[m.toFieldId] = remappedVal
        } else {
          const existing = values[m.toFieldId]
          if (
            fieldUsesMultiOptionIds(toField.type) &&
            Array.isArray(remappedVal) &&
            Array.isArray(existing)
          ) {
            const seen = new Set(existing.filter((x): x is string => typeof x === 'string'))
            for (const id of remappedVal) {
              if (typeof id === 'string' && !seen.has(id)) {
                seen.add(id)
                ;(existing as string[]).push(id)
              }
            }
            values[m.toFieldId] = [...seen]
          } else {
            values[m.toFieldId] = remappedVal
          }
          delete values[m.fromFieldId]
        }
        changed = true
        remapped++
      }

      if (!changed) continue
      await writeDocOrDelete(hostPath, values)
      touched.push(hostPath)
    } catch {
      /* soft */
    }
  }

  if (touched.length) await invalidateColumnMetaPaths(touched)
  return { ok: true as const, remapped }
}
