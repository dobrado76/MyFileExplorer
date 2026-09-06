/**
 * Metadata pack — ZIP of relative paths → mfe_meta JSON + definitions sidecar (D70).
 * Distinct from Compress-to-ZIP (ADS-free).
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import JSZip from 'jszip'
import { AppError } from '@shared/result'
import {
  USER_METADATA_FORMAT,
  USER_METADATA_STREAM,
  allUserMetadataFields,
  migrateUserMetadataSettings,
  parseUserMetadataDoc,
  userMetadataSettingsSchema,
  type UserMetadataDoc,
  type UserMetadataField,
  type UserMetadataSettings
} from '@shared/schemas/userMetadata'
import type {
  UserMetadataPackDefinitionConflict,
  UserMetadataPackImportResult
} from '@shared/userMetadataPack'
import { requireAbsolute } from '../fs/list'
import {
  readStreamText,
  streamExists,
  writeStreamText,
  withPreservedHostTimes
} from '../fs/adsWin32'
import { getSettings, patchSettings } from '../settings/store'
import { invalidateColumnMetaPaths } from '../meta/columns'
import { walkUserMetadataHosts } from './walk'

const PACK_MANIFEST = 'mfe-metadata-pack.json'
const VALUES_PREFIX = 'values/'

type PackManifest = {
  format: 'MyFileExplorer.MetadataPack'
  version: 1
  exportedAt: string
  definitions: UserMetadataSettings
}

function relPosix(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/')
}

/** ZIP entry under values/; root host → `values/.json` (rel `.` on import). */
function valuesEntryName(rel: string): string {
  return rel === '' ? `${VALUES_PREFIX}.json` : `${VALUES_PREFIX}${rel}.json`
}

export async function exportMetadataPack(opts?: {
  folderPath?: string
  zipPath?: string
}): Promise<{ path: string; count: number }> {
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'Metadata pack requires Windows NTFS')
  }
  const win = BrowserWindow.getFocusedWindow()
  let folder = opts?.folderPath
  if (!folder) {
    const pick = win
      ? await dialog.showOpenDialog(win, {
          title: 'Export metadata pack — choose folder',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({
          title: 'Export metadata pack — choose folder',
          properties: ['openDirectory']
        })
    if (pick.canceled || !pick.filePaths[0]) {
      throw new AppError('cancelled', 'Export cancelled')
    }
    folder = pick.filePaths[0]
  }
  folder = requireAbsolute(folder)

  let zipPath = opts?.zipPath
  if (!zipPath) {
    const save = win
      ? await dialog.showSaveDialog(win, {
          title: 'Save metadata pack',
          defaultPath: path.join(folder, 'metadata-pack.zip'),
          filters: [{ name: 'ZIP', extensions: ['zip'] }]
        })
      : await dialog.showSaveDialog({
          title: 'Save metadata pack',
          defaultPath: path.join(folder, 'metadata-pack.zip'),
          filters: [{ name: 'ZIP', extensions: ['zip'] }]
        })
    if (save.canceled || !save.filePath) {
      throw new AppError('cancelled', 'Export cancelled')
    }
    zipPath = save.filePath
  }

  const definitions = getSettings().userMetadata ?? { enabled: false, sets: [], bindings: [] }
  const zip = new JSZip()
  const manifest: PackManifest = {
    format: 'MyFileExplorer.MetadataPack',
    version: 1,
    exportedAt: new Date().toISOString(),
    definitions
  }
  zip.file(PACK_MANIFEST, JSON.stringify(manifest, null, 2))

  const hosts = await walkUserMetadataHosts(folder)
  let count = 0
  for (const host of hosts) {
    try {
      if (!streamExists(host, USER_METADATA_STREAM)) continue
      const raw = await readStreamText(host, USER_METADATA_STREAM)
      const doc = parseUserMetadataDoc(raw)
      if (!doc || Object.keys(doc.values).length === 0) continue
      const rel = relPosix(folder, host)
      zip.file(valuesEntryName(rel), JSON.stringify(doc, null, 2))
      count++
    } catch {
      /* soft */
    }
  }

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fsp.writeFile(zipPath, buf)
  return { path: zipPath, count }
}

function planDefinitionMerge(
  cur: UserMetadataSettings,
  incoming: UserMetadataSettings
): {
  addSets: number
  addFields: number
  skipFields: number
  conflicts: UserMetadataPackDefinitionConflict[]
  merged: UserMetadataSettings | null
} {
  const conflicts: UserMetadataPackDefinitionConflict[] = []
  let addSets = 0
  let addFields = 0
  let skipFields = 0

  const setById = new Map(cur.sets.map((s) => [s.id, { ...s, fields: [...s.fields] }]))
  const globalFields = new Map(allUserMetadataFields(cur).map((f) => [f.id, f]))

  const conflictReason = (existing: UserMetadataField, incomingF: UserMetadataField): string | null => {
    if (existing.key !== incomingF.key) {
      return `Field id exists with key “${existing.key}”; pack has “${incomingF.key}”`
    }
    if (existing.type !== incomingF.type) {
      return `Field id exists as ${existing.type}; pack has ${incomingF.type}`
    }
    return null
  }

  for (const incomingSet of incoming.sets) {
    const existing = setById.get(incomingSet.id)
    if (!existing) {
      addSets++
      const fields: UserMetadataField[] = []
      for (const f of incomingSet.fields) {
        const g = globalFields.get(f.id)
        if (g) {
          const reason = conflictReason(g, f)
          if (reason) {
            conflicts.push({ setId: incomingSet.id, fieldId: f.id, reason })
          } else {
            skipFields++
          }
          continue
        }
        fields.push(f)
        globalFields.set(f.id, f)
        addFields++
      }
      setById.set(incomingSet.id, { ...incomingSet, fields: fields.slice(0, 32) })
    } else {
      const byId = new Map(existing.fields.map((f) => [f.id, f]))
      for (const f of incomingSet.fields) {
        const local = byId.get(f.id) ?? globalFields.get(f.id)
        if (local) {
          const reason = conflictReason(local, f)
          if (reason) {
            conflicts.push({ setId: incomingSet.id, fieldId: f.id, reason })
          } else {
            skipFields++
          }
          continue
        }
        byId.set(f.id, f)
        globalFields.set(f.id, f)
        addFields++
      }
      existing.fields = [...byId.values()].slice(0, 32)
    }
  }

  const merged: UserMetadataSettings = {
    enabled: cur.enabled === true,
    showToolbarButton: cur.showToolbarButton === true,
    sets: [...setById.values()].slice(0, 32),
    bindings: cur.bindings
  }
  const ok = userMetadataSettingsSchema.safeParse(merged)
  return {
    addSets,
    addFields,
    skipFields,
    conflicts,
    merged: ok.success ? ok.data : null
  }
}

export async function importMetadataPack(opts?: {
  zipPath?: string
  destFolder?: string
  mergeDefinitions?: boolean
  dryRun?: boolean
}): Promise<UserMetadataPackImportResult> {
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'Metadata pack requires Windows NTFS')
  }
  const dryRun = opts?.dryRun === true
  const win = BrowserWindow.getFocusedWindow()
  let zipPath = opts?.zipPath
  if (!zipPath) {
    const pick = win
      ? await dialog.showOpenDialog(win, {
          title: 'Import metadata pack',
          filters: [{ name: 'ZIP', extensions: ['zip'] }],
          properties: ['openFile']
        })
      : await dialog.showOpenDialog({
          title: 'Import metadata pack',
          filters: [{ name: 'ZIP', extensions: ['zip'] }],
          properties: ['openFile']
        })
    if (pick.canceled || !pick.filePaths[0]) {
      throw new AppError('cancelled', 'Import cancelled')
    }
    zipPath = pick.filePaths[0]
  }

  let dest = opts?.destFolder
  if (!dest) {
    const pick = win
      ? await dialog.showOpenDialog(win, {
          title: 'Apply pack into folder',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({
          title: 'Apply pack into folder',
          properties: ['openDirectory']
        })
    if (pick.canceled || !pick.filePaths[0]) {
      throw new AppError('cancelled', 'Import cancelled')
    }
    dest = pick.filePaths[0]
  }
  dest = requireAbsolute(dest)

  const data = await fsp.readFile(zipPath)
  const zip = await JSZip.loadAsync(data)
  const manFile = zip.file(PACK_MANIFEST)
  if (!manFile) throw new AppError('validation', 'Not a metadata pack (missing manifest)')
  const man = JSON.parse(await manFile.async('string')) as PackManifest
  if (man.format !== 'MyFileExplorer.MetadataPack') {
    throw new AppError('validation', 'Invalid metadata pack format')
  }

  const cur = getSettings().userMetadata ?? { enabled: false, sets: [], bindings: [] }
  let plan = {
    addSets: 0,
    addFields: 0,
    skipFields: 0,
    conflicts: [] as UserMetadataPackDefinitionConflict[],
    merged: null as UserMetadataSettings | null
  }

  if (opts?.mergeDefinitions !== false && man.definitions) {
    const migrated = migrateUserMetadataSettings(man.definitions)
    const parsed = userMetadataSettingsSchema.safeParse(migrated)
    if (parsed.success && parsed.data.sets.some((s) => s.fields.length > 0)) {
      plan = planDefinitionMerge(cur, parsed.data)
    }
  }

  let create = 0
  let overwrite = 0
  let skipMissing = 0
  let written = 0
  const paths: string[] = []

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    if (!name.startsWith(VALUES_PREFIX) || !name.endsWith('.json')) continue
    const rel = name.slice(VALUES_PREFIX.length, -'.json'.length)
    // Allow `.` for pack root host; reject empty after strip only if not `.`
    if (!rel || rel.includes('..')) continue
    const target = rel === '.' ? dest : path.join(dest, ...rel.split('/'))
    try {
      const raw = await entry.async('string')
      const doc = parseUserMetadataDoc(raw) as UserMetadataDoc | null
      if (!doc) continue
      try {
        await fsp.access(target)
      } catch {
        skipMissing++
        continue
      }
      const hasStream = streamExists(target, USER_METADATA_STREAM)
      if (dryRun) {
        if (hasStream) overwrite++
        else create++
        continue
      }
      await withPreservedHostTimes(target, async () => {
        await writeStreamText(
          target,
          USER_METADATA_STREAM,
          JSON.stringify({
            ...doc,
            format: USER_METADATA_FORMAT,
            version: 1,
            updatedAt: new Date().toISOString()
          }),
          false,
          { preserveHostTimes: false }
        )
      })
      written++
      paths.push(target)
    } catch {
      /* IO — soft */
    }
  }

  if (dryRun) {
    return {
      dryRun: true as const,
      definitions: {
        addSets: plan.addSets,
        addFields: plan.addFields,
        skipFields: plan.skipFields,
        conflicts: plan.conflicts
      },
      values: { create, overwrite, skipMissing }
    }
  }

  let definitionsMerged = false
  if (opts?.mergeDefinitions !== false && plan.merged) {
    patchSettings({ userMetadata: plan.merged })
    definitionsMerged = true
  }

  if (paths.length) await invalidateColumnMetaPaths(paths)
  return { written, definitionsMerged }
}
