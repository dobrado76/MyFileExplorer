import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { AppError } from '@shared/result'
import { uniqueScriptName } from '@shared/scriptNames'
import { parseScriptImport } from '@shared/scriptImport'
import {
  applyGlobalScriptRules,
  defaultScriptDefinition,
  languageFromExtension,
  MFESCRIPT_FORMAT,
  MFESCRIPT_FORMAT_VERSION,
  newScriptId,
  scriptDefinitionSchema,
  scriptFileExtension,
  scriptLibraryFileSchema,
  type ScriptDefinition,
  type ScriptLanguage
} from '@shared/schemas/scripts'
import { JsonStore } from '../store/jsonStore'
import { requireAbsolute } from '../fs/list'

const emptyFile = { version: 1 as const, scripts: [] as ScriptDefinition[] }

let store: JsonStore<typeof emptyFile> | null = null

function scriptsRoot(): string {
  return path.join(app.getPath('userData'), 'scripts')
}

function libraryPath(): string {
  return path.join(scriptsRoot(), 'library.json')
}

function managedDir(): string {
  return path.join(scriptsRoot(), 'managed')
}

function backupsDir(): string {
  return path.join(scriptsRoot(), 'backups')
}

function libraryStore(): JsonStore<typeof emptyFile> {
  if (!store) {
    fs.mkdirSync(scriptsRoot(), { recursive: true })
    store = new JsonStore(libraryPath(), scriptLibraryFileSchema, emptyFile, 200)
  }
  return store
}

function persist(scripts: ScriptDefinition[]): ScriptDefinition[] {
  const sorted = [...scripts].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
  libraryStore().replace({ version: 1, scripts: sorted })
  libraryStore().flush()
  return sorted
}

export function listScripts(): ScriptDefinition[] {
  return scriptLibraryFileSchema.parse(libraryStore().get()).scripts.map(applyGlobalScriptRules)
}

export function getScript(id: string): ScriptDefinition {
  const found = listScripts().find((s) => s.id === id)
  if (!found) throw new AppError('not-found', 'Script not found')
  return found
}

export function managedSourcePath(script: ScriptDefinition): string {
  return path.join(managedDir(), `${script.id}${scriptFileExtension(script.language)}`)
}

export function previousSourcePath(id: string): string {
  return path.join(backupsDir(), `${id}.prev`)
}

export async function readScriptSource(script: ScriptDefinition): Promise<string> {
  if (script.sourceKind === 'external') {
    if (!script.externalPath) throw new AppError('validation', 'External script has no path')
    const abs = requireAbsolute(script.externalPath)
    return fsp.readFile(abs, 'utf8')
  }
  const file = managedSourcePath(script)
  try {
    return await fsp.readFile(file, 'utf8')
  } catch {
    return ''
  }
}

export async function writeManagedSource(
  script: ScriptDefinition,
  source: string,
  opts?: { backupPrevious?: boolean }
): Promise<void> {
  fs.mkdirSync(managedDir(), { recursive: true })
  const file = managedSourcePath(script)
  if (opts?.backupPrevious) {
    try {
      const prev = await fsp.readFile(file, 'utf8')
      fs.mkdirSync(backupsDir(), { recursive: true })
      await fsp.writeFile(previousSourcePath(script.id), prev, 'utf8')
    } catch {
      /* no previous */
    }
  }
  await fsp.writeFile(file, source, 'utf8')
}

export async function revertScriptSource(id: string): Promise<{ source: string }> {
  const script = getScript(id)
  if (script.sourceKind !== 'managed') {
    throw new AppError('not-allowed', 'Revert is only available for managed scripts')
  }
  const backup = previousSourcePath(id)
  let prev: string
  try {
    prev = await fsp.readFile(backup, 'utf8')
  } catch {
    throw new AppError('not-found', 'No previous version to revert')
  }
  await writeManagedSource(script, prev)
  return { source: prev }
}

export function hasPreviousSource(id: string): boolean {
  try {
    return fs.existsSync(previousSourcePath(id))
  } catch {
    return false
  }
}

export async function upsertScript(input: {
  script: Partial<ScriptDefinition> & { name?: string; language?: ScriptLanguage }
  source: string
  backupPrevious?: boolean
}): Promise<ScriptDefinition> {
  const now = new Date().toISOString()
  const existing = input.script.id ? listScripts().find((s) => s.id === input.script.id) : undefined
  const id = existing?.id ?? newScriptId()
  const base = existing ?? {
    ...defaultScriptDefinition(),
    id,
    createdAt: now,
    updatedAt: now
  }
  const next = applyGlobalScriptRules(
    scriptDefinitionSchema.parse({
      ...base,
      ...input.script,
      id,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      name: uniqueScriptName(
        (input.script.name ?? base.name).trim() || 'Untitled script',
        listScripts()
          .filter((s) => s.id !== id)
          .map((s) => s.name)
      )
    })
  )
  if (!next.name) throw new AppError('validation', 'Name is required')
  if (next.sourceKind === 'external') {
    if (!next.externalPath) throw new AppError('validation', 'External script path is required')
    const abs = requireAbsolute(next.externalPath)
    next.externalPath = abs
    // Path only — do not overwrite the file from the (hidden) in-app editor.
  } else {
    if (existing && existing.language !== next.language) {
      try {
        await fsp.unlink(managedSourcePath(existing))
      } catch {
        /* ignore */
      }
    }
    await writeManagedSource(next, input.source, { backupPrevious: input.backupPrevious })
  }
  const all = listScripts().filter((s) => s.id !== id)
  all.push(next)
  persist(all)
  return next
}

export async function deleteScript(id: string): Promise<void> {
  const script = getScript(id)
  if (script.sourceKind === 'managed') {
    try {
      await fsp.unlink(managedSourcePath(script))
    } catch {
      /* ignore */
    }
    try {
      await fsp.unlink(previousSourcePath(id))
    } catch {
      /* ignore */
    }
  }
  persist(listScripts().filter((s) => s.id !== id))
}

export async function duplicateScript(id: string, name?: string): Promise<ScriptDefinition> {
  const script = getScript(id)
  const source = await readScriptSource(script)
  return upsertScript({
    script: {
      ...script,
      id: undefined,
      name: uniqueScriptName(
        name?.trim() || script.name,
        listScripts().map((s) => s.name)
      ),
      sourceKind: 'managed',
      externalPath: undefined
    },
    source
  })
}

export async function exportScriptDocument(id: string): Promise<{
  json: string
  suggestedName: string
}> {
  const script = getScript(id)
  const source = await readScriptSource(script)
  const { id: _id, createdAt: _c, updatedAt: _u, externalPath: _e, ...rest } = script
  const doc = {
    format: MFESCRIPT_FORMAT,
    formatVersion: MFESCRIPT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    script: { ...rest, sourceKind: 'managed' as const },
    source
  }
  const safe = script.name.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'script'
  return {
    json: JSON.stringify(doc, null, 2),
    suggestedName: `${safe}.mfescript`
  }
}

export async function importScriptDocument(json: string): Promise<ScriptDefinition> {
  const parsed = parseScriptImport('import.mfescript', json)
  return upsertScript({ script: parsed.script, source: parsed.source })
}

export async function importScriptFromFile(filePath: string): Promise<ScriptDefinition> {
  const abs = requireAbsolute(filePath)
  const text = await fsp.readFile(abs, 'utf8')
  const parsed = parseScriptImport(abs, text)
  return upsertScript({ script: parsed.script, source: parsed.source })
}

export type ScriptExportBundle = {
  id: string
  script: ScriptDefinition
  source: string
}

/** Portable library (source yes, no secrets). */
export async function listScriptsForExport(): Promise<ScriptExportBundle[]> {
  const out: ScriptExportBundle[] = []
  for (const script of listScripts()) {
    try {
      const source = await readScriptSource(script)
      out.push({
        id: script.id,
        script: { ...script, sourceKind: 'managed', externalPath: undefined },
        source
      })
    } catch {
      out.push({ id: script.id, script, source: '' })
    }
  }
  return out
}

export async function replaceScriptsFromExport(bundles: ScriptExportBundle[]): Promise<number> {
  for (const s of listScripts()) {
    await deleteScript(s.id)
  }
  for (const b of bundles) {
    await upsertScript({
      script: {
        ...b.script,
        id: b.script.id || newScriptId(),
        sourceKind: 'managed',
        externalPath: undefined
      },
      source: b.source
    })
  }
  return listScripts().length
}

export function resolveScriptFile(script: ScriptDefinition): string {
  if (script.sourceKind === 'external') {
    if (!script.externalPath) throw new AppError('validation', 'External script has no path')
    return requireAbsolute(script.externalPath)
  }
  return managedSourcePath(script)
}

export function languageForExternalPath(filePath: string): ScriptLanguage {
  const lang = languageFromExtension(filePath)
  if (!lang) throw new AppError('validation', 'Unsupported script extension')
  return lang
}
