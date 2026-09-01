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
  type UserMetadataSettings
} from '@shared/schemas/userMetadata'
import { requireAbsolute } from '../fs/list'
import { readStreamText, streamExists, writeStreamText, withPreservedHostTimes } from '../fs/adsWin32'
import { getSettings, patchSettings } from '../settings/store'
import { invalidateColumnMetaPaths } from '../meta/columns'

const PACK_MANIFEST = 'mfe-metadata-pack.json'
const VALUES_PREFIX = 'values/'

type PackManifest = {
  format: 'MyFileExplorer.MetadataPack'
  version: 1
  exportedAt: string
  definitions: UserMetadataSettings
}

async function walkFiles(root: string, max = 50_000): Promise<string[]> {
  const out: string[] = []
  const stack = [root]
  while (stack.length && out.length < max) {
    const dir = stack.pop()!
    let ents
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.isFile() || e.isSymbolicLink()) out.push(full)
      if (out.length >= max) break
    }
  }
  return out
}

function relPosix(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/')
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

  const files = await walkFiles(folder)
  let count = 0
  for (const file of files) {
    try {
      if (!streamExists(file, USER_METADATA_STREAM)) continue
      const raw = await readStreamText(file, USER_METADATA_STREAM)
      const doc = parseUserMetadataDoc(raw)
      if (!doc || Object.keys(doc.values).length === 0) continue
      const rel = relPosix(folder, file)
      zip.file(`${VALUES_PREFIX}${rel}.json`, JSON.stringify(doc, null, 2))
      count++
    } catch {
      /* soft */
    }
  }

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fsp.writeFile(zipPath, buf)
  return { path: zipPath, count }
}

export async function importMetadataPack(opts?: {
  zipPath?: string
  destFolder?: string
  mergeDefinitions?: boolean
}): Promise<{ written: number; definitionsMerged: boolean }> {
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'Metadata pack requires Windows NTFS')
  }
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

  let definitionsMerged = false
  if (opts?.mergeDefinitions !== false && man.definitions) {
    const migrated = migrateUserMetadataSettings(man.definitions)
    const parsed = userMetadataSettingsSchema.safeParse(migrated)
    if (parsed.success && parsed.data.sets.some((s) => s.fields.length > 0)) {
      const cur = getSettings().userMetadata ?? { enabled: false, sets: [], bindings: [] }
      const setById = new Map(cur.sets.map((s) => [s.id, { ...s, fields: [...s.fields] }]))
      const globalFields = new Map(allUserMetadataFields(cur).map((f) => [f.id, f]))
      for (const incoming of parsed.data.sets) {
        const existing = setById.get(incoming.id)
        if (!existing) {
          const fields = incoming.fields.filter((f) => !globalFields.has(f.id)).slice(0, 32)
          for (const f of fields) globalFields.set(f.id, f)
          setById.set(incoming.id, { ...incoming, fields })
        } else {
          const byId = new Map(existing.fields.map((f) => [f.id, f]))
          for (const f of incoming.fields) {
            if (!byId.has(f.id) && !globalFields.has(f.id)) {
              byId.set(f.id, f)
              globalFields.set(f.id, f)
            }
          }
          existing.fields = [...byId.values()].slice(0, 32)
        }
      }
      const merged: UserMetadataSettings = {
        enabled: cur.enabled === true,
        sets: [...setById.values()].slice(0, 32),
        bindings: cur.bindings
      }
      const ok = userMetadataSettingsSchema.safeParse(merged)
      if (ok.success) {
        patchSettings({ userMetadata: ok.data })
        definitionsMerged = true
      }
    }
  }

  let written = 0
  const paths: string[] = []
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    if (!name.startsWith(VALUES_PREFIX) || !name.endsWith('.json')) continue
    const rel = name.slice(VALUES_PREFIX.length, -'.json'.length)
    if (!rel || rel.includes('..')) continue
    const target = path.join(dest, ...rel.split('/'))
    try {
      const raw = await entry.async('string')
      const doc = parseUserMetadataDoc(raw) as UserMetadataDoc | null
      if (!doc) continue
      await fsp.access(target)
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
      /* missing target or IO — soft */
    }
  }
  if (paths.length) await invalidateColumnMetaPaths(paths)
  return { written, definitionsMerged }
}
