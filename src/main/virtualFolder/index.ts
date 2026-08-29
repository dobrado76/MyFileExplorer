import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '@shared/result'
import {
  VIRTUAL_FOLDER_EXT,
  chooseVirtualFolderStoredPath,
  emptyVirtualFolderDocument,
  entryDisplayName,
  inferVirtualFolderEntryKind,
  isVirtualFolderDocumentPath,
  newVirtualFolderEntryId,
  virtualFolderDisplayName,
  virtualFolderDocumentDir,
  virtualFolderEntryDuplicateKey,
  resolveVirtualFolderEntryPath,
  serializeVirtualFolderDocument,
  type VirtualFolderDocument,
  type VirtualFolderEntry,
  type VirtualFolderMembership
} from '@shared/virtualFolder'
import { parseVirtualFolderJson } from '@shared/schemas/virtualFolder'
import type {
  VirtualFolderListItem,
  VirtualFolderListResponse,
  VirtualFolderMutateResponse,
  VirtualFolderPreviewStats
} from '@shared/schemas/virtualFolder'
import type { DirEntry } from '@shared/schemas/fs'
import { samePath } from '@shared/paths'
import { requireAbsolute } from '../fs/list'
import { pathIsReadOnly } from '../fs/winAttrs'

export class VirtualFolderConflictError extends AppError {
  constructor(documentPath: string) {
    super(
      'conflict',
      'Virtual Folder changed outside MyFileExplorer.',
      undefined,
      documentPath
    )
  }
}

async function readDocumentFile(documentPath: string): Promise<{
  document: VirtualFolderDocument
  mtimeMs: number
  warnings: string[]
  raw: string
}> {
  const abs = requireAbsolute(documentPath)
  if (!isVirtualFolderDocumentPath(abs)) {
    throw new AppError('validation', 'Not a Virtual Folder document', undefined, abs)
  }
  let st
  try {
    st = await fsp.stat(abs)
  } catch (e) {
    throw new AppError('not-found', `Virtual Folder not found: ${String(e)}`, undefined, abs)
  }
  if (!st.isFile()) {
    throw new AppError('validation', 'Virtual Folder path is not a file', undefined, abs)
  }
  const raw = await fsp.readFile(abs, 'utf8')
  const parsed = parseVirtualFolderJson(raw)
  if (!parsed.ok) {
    throw new AppError('validation', parsed.error, undefined, abs)
  }
  return {
    document: parsed.document,
    mtimeMs: st.mtimeMs,
    warnings: parsed.warnings,
    raw
  }
}

async function isWritableFile(abs: string): Promise<boolean> {
  try {
    if (pathIsReadOnly(abs)) return false
    await fsp.access(abs, fsp.constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function atomicWriteDocument(abs: string, document: VirtualFolderDocument): Promise<number> {
  const text = serializeVirtualFolderDocument(document)
  const tmp = abs + '.tmp'
  await fsp.writeFile(tmp, text, 'utf8')
  try {
    await fsp.rename(tmp, abs)
  } catch {
    await fsp.copyFile(tmp, abs)
    await fsp.unlink(tmp).catch(() => undefined)
  }
  const st = await fsp.stat(abs)
  return st.mtimeMs
}

function assertExpectedMtime(mtimeMs: number, expected?: number): void {
  if (expected == null || !Number.isFinite(expected)) return
  if (Math.abs(mtimeMs - expected) > 1.5) {
    throw new VirtualFolderConflictError('')
  }
}

async function resolveMembership(
  documentPath: string,
  entry: VirtualFolderEntry
): Promise<{ membership: VirtualFolderMembership; dirEntry: DirEntry }> {
  const storedPath = entry.path
  const resolved = resolveVirtualFolderEntryPath(documentPath, entry)
  const baseName = entryDisplayName(entry, path.basename(resolved || storedPath))

  let state: VirtualFolderMembership['state'] = 'missing'
  let size = 0
  let mtimeMs = 0
  let birthtimeMs = 0
  let kind: DirEntry['kind'] = entry.kind === 'folder' ? 'dir' : 'file'
  let isHidden = false
  let ext = ''

  if (resolved) {
    try {
      const st = await fsp.lstat(resolved)
      state = 'resolved'
      size = st.isDirectory() ? 0 : st.size
      mtimeMs = st.mtimeMs
      birthtimeMs = st.birthtimeMs
      kind = st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : 'file'
      ext = path.extname(path.basename(resolved)).replace(/^\./, '').toLowerCase()
      isHidden = path.basename(resolved).startsWith('.')
    } catch (e) {
      const code =
        e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : ''
      state = code === 'EACCES' || code === 'EPERM' ? 'inaccessible' : 'missing'
      ext = path.extname(baseName).replace(/^\./, '').toLowerCase()
      if (entry.kind === 'folder' || entry.kind === 'virtualFolder') kind = 'dir'
    }
  }

  // Nested Virtual Folder members should appear folder-like.
  if (entry.kind === 'virtualFolder' || (state === 'resolved' && isVirtualFolderDocumentPath(resolved))) {
    kind = 'dir'
    ext = VIRTUAL_FOLDER_EXT.slice(1)
    size = 0
  }

  const membership: VirtualFolderMembership = {
    entryId: entry.id,
    virtualFolderPath: documentPath,
    storedPath,
    resolvedPath: state === 'resolved' ? resolved : resolved || null,
    expectedKind: entry.kind,
    state,
    ...(entry.label != null ? { label: entry.label } : {}),
    ...(entry.note != null ? { note: entry.note } : {}),
    ...(entry.relative != null ? { relative: entry.relative } : {})
  }

  const dirEntry: DirEntry = {
    name: baseName,
    // Row path is the resolved target when known; for missing, keep stored absolute attempt.
    path: resolved || storedPath,
    kind,
    size,
    mtimeMs,
    birthtimeMs,
    ext,
    isHidden
  }

  return { membership, dirEntry }
}

export async function getVirtualFolder(documentPath: string): Promise<{
  document: VirtualFolderDocument
  mtimeMs: number
  readOnly: boolean
  warnings: string[]
}> {
  const abs = requireAbsolute(documentPath)
  const loaded = await readDocumentFile(abs)
  return {
    document: loaded.document,
    mtimeMs: loaded.mtimeMs,
    readOnly: !(await isWritableFile(abs)),
    warnings: loaded.warnings
  }
}

export async function listVirtualFolder(documentPath: string): Promise<VirtualFolderListResponse> {
  const abs = requireAbsolute(documentPath)
  const loaded = await readDocumentFile(abs)
  const items: VirtualFolderListItem[] = []
  const CONCURRENCY = 32
  for (let i = 0; i < loaded.document.entries.length; i += CONCURRENCY) {
    const batch = loaded.document.entries.slice(i, i + CONCURRENCY)
    const rows = await Promise.all(batch.map((e) => resolveMembership(abs, e)))
    items.push(...rows.map((r) => ({ entry: r.dirEntry, membership: r.membership })))
  }
  return {
    path: abs,
    document: loaded.document,
    mtimeMs: loaded.mtimeMs,
    readOnly: !(await isWritableFile(abs)),
    entries: items,
    warnings: loaded.warnings
  }
}

export async function previewVirtualFolderStats(
  documentPath: string
): Promise<VirtualFolderPreviewStats> {
  const abs = requireAbsolute(documentPath)
  const loaded = await readDocumentFile(abs)
  let fileCount = 0
  let folderCount = 0
  let virtualFolderCount = 0
  let missingCount = 0
  let knownFileBytes = 0
  const locationKeys = new Set<string>()
  const locationSamples: string[] = []

  for (const entry of loaded.document.entries) {
    if (entry.kind === 'virtualFolder') virtualFolderCount++
    else if (entry.kind === 'folder') folderCount++
    else fileCount++

    const resolved = resolveVirtualFolderEntryPath(abs, entry)
    try {
      const st = await fsp.stat(resolved)
      if (st.isFile()) knownFileBytes += st.size
      const parent = path.dirname(resolved)
      const key = parent.toLowerCase()
      if (!locationKeys.has(key) && locationSamples.length < 8) {
        locationKeys.add(key)
        locationSamples.push(parent)
      }
    } catch {
      missingCount++
    }
  }

  return {
    entryCount: loaded.document.entries.length,
    fileCount,
    folderCount,
    virtualFolderCount,
    missingCount,
    knownFileBytes,
    locationSamples
  }
}

export async function createVirtualFolder(
  parentDir: string,
  name = 'New Virtual Folder'
): Promise<{ path: string; document: VirtualFolderDocument; mtimeMs: number }> {
  const dir = requireAbsolute(parentDir)
  const base =
    [...name]
      .filter((ch) => {
        const c = ch.charCodeAt(0)
        if (c < 32) return false
        return !'<>:"/\\|?*'.includes(ch)
      })
      .join('')
      .trim() || 'New Virtual Folder'
  const fileName = base.toLowerCase().endsWith(VIRTUAL_FOLDER_EXT) ? base : `${base}${VIRTUAL_FOLDER_EXT}`
  let dest = path.join(dir, fileName)
  let n = 2
  while (true) {
    try {
      await fsp.access(dest)
      const stem = fileName.slice(0, -VIRTUAL_FOLDER_EXT.length)
      dest = path.join(dir, `${stem} (${n})${VIRTUAL_FOLDER_EXT}`)
      n++
    } catch {
      break
    }
  }
  const document = emptyVirtualFolderDocument()
  const mtimeMs = await atomicWriteDocument(dest, document)
  return { path: dest, document, mtimeMs }
}

async function mutateDocument(
  documentPath: string,
  expectedMtimeMs: number | undefined,
  mutator: (doc: VirtualFolderDocument) => VirtualFolderMutateResponse | void
): Promise<VirtualFolderMutateResponse> {
  const abs = requireAbsolute(documentPath)
  const loaded = await readDocumentFile(abs)
  try {
    assertExpectedMtime(loaded.mtimeMs, expectedMtimeMs)
  } catch (e) {
    if (e instanceof VirtualFolderConflictError) {
      throw new VirtualFolderConflictError(abs)
    }
    throw e
  }
  if (!(await isWritableFile(abs))) {
    throw new AppError('not-allowed', 'Virtual Folder is read-only', undefined, abs)
  }
  const doc: VirtualFolderDocument = {
    ...loaded.document,
    entries: [...loaded.document.entries],
    settings: loaded.document.settings ? { ...loaded.document.settings } : undefined
  }
  const extra = mutator(doc) ?? {}
  doc.modified = new Date().toISOString()
  const mtimeMs = await atomicWriteDocument(abs, doc)
  return {
    document: doc,
    mtimeMs,
    ...extra
  }
}

export async function addVirtualFolderEntries(
  documentPath: string,
  paths: string[],
  expectedMtimeMs?: number
): Promise<VirtualFolderMutateResponse> {
  const abs = requireAbsolute(documentPath)
  const loaded = await readDocumentFile(abs)
  try {
    assertExpectedMtime(loaded.mtimeMs, expectedMtimeMs)
  } catch (e) {
    if (e instanceof VirtualFolderConflictError) throw new VirtualFolderConflictError(abs)
    throw e
  }
  if (!(await isWritableFile(abs))) {
    throw new AppError('not-allowed', 'Virtual Folder is read-only', undefined, abs)
  }

  const doc: VirtualFolderDocument = {
    ...loaded.document,
    entries: [...loaded.document.entries],
    settings: loaded.document.settings ? { ...loaded.document.settings } : undefined
  }
  const existing = new Set(doc.entries.map((e) => virtualFolderEntryDuplicateKey(abs, e)))
  let added = 0
  let skippedDuplicates = 0
  for (const raw of paths) {
    const target = requireAbsolute(raw)
    const stored = chooseVirtualFolderStoredPath(abs, target)
    const key = virtualFolderEntryDuplicateKey(abs, stored)
    if (existing.has(key)) {
      skippedDuplicates++
      continue
    }
    let kind = inferVirtualFolderEntryKind(null, target)
    try {
      const st = await fsp.stat(target)
      kind = inferVirtualFolderEntryKind(st.isDirectory() ? 'dir' : 'file', target)
    } catch {
      /* keep path-based inference */
    }
    doc.entries.push({
      id: newVirtualFolderEntryId(),
      kind,
      path: stored.path,
      relative: stored.relative
    })
    existing.add(key)
    added++
  }
  doc.modified = new Date().toISOString()
  const mtimeMs = await atomicWriteDocument(abs, doc)
  return { document: doc, mtimeMs, added, skippedDuplicates }
}

export async function removeVirtualFolderEntries(
  documentPath: string,
  entryIds: string[],
  expectedMtimeMs?: number
): Promise<VirtualFolderMutateResponse> {
  const idSet = new Set(entryIds)
  return mutateDocument(documentPath, expectedMtimeMs, (doc) => {
    const before = doc.entries.length
    doc.entries = doc.entries.filter((e) => !idSet.has(e.id))
    return { removed: before - doc.entries.length } as VirtualFolderMutateResponse
  })
}

export async function reorderVirtualFolderEntries(
  documentPath: string,
  entryIds: string[],
  expectedMtimeMs?: number
): Promise<VirtualFolderMutateResponse> {
  return mutateDocument(documentPath, expectedMtimeMs, (doc) => {
    const byId = new Map(doc.entries.map((e) => [e.id, e]))
    const next: VirtualFolderEntry[] = []
    for (const id of entryIds) {
      const e = byId.get(id)
      if (e) {
        next.push(e)
        byId.delete(id)
      }
    }
    for (const e of byId.values()) next.push(e)
    doc.entries = next
    doc.settings = { ...doc.settings, manualOrder: true }
  })
}

export async function relinkVirtualFolderEntry(
  documentPath: string,
  entryId: string,
  newPath: string,
  expectedMtimeMs?: number
): Promise<VirtualFolderMutateResponse> {
  return mutateDocument(documentPath, expectedMtimeMs, (doc) => {
    const abs = requireAbsolute(documentPath)
    const target = requireAbsolute(newPath)
    const entry = doc.entries.find((e) => e.id === entryId)
    if (!entry) throw new AppError('not-found', 'Virtual Folder entry not found', undefined, abs)
    const stored = chooseVirtualFolderStoredPath(abs, target)
    try {
      const st = fs.statSync(target)
      entry.kind = inferVirtualFolderEntryKind(st.isDirectory() ? 'dir' : 'file', target)
    } catch {
      entry.kind = inferVirtualFolderEntryKind(null, target)
    }
    entry.path = stored.path
    entry.relative = stored.relative
  })
}

export async function setVirtualFolderEntryLabel(
  documentPath: string,
  entryId: string,
  label: string | null,
  expectedMtimeMs?: number
): Promise<VirtualFolderMutateResponse> {
  return mutateDocument(documentPath, expectedMtimeMs, (doc) => {
    const entry = doc.entries.find((e) => e.id === entryId)
    if (!entry) {
      throw new AppError('not-found', 'Virtual Folder entry not found', undefined, documentPath)
    }
    if (label == null || !label.trim()) delete entry.label
    else entry.label = label.trim()
  })
}

/** Update stored paths when MFE renames/moves targets referenced by an open document. */
export async function updateVirtualFolderTargetPaths(
  documentPath: string,
  renames: { from: string; to: string }[],
  expectedMtimeMs?: number
): Promise<VirtualFolderMutateResponse> {
  return mutateDocument(documentPath, expectedMtimeMs, (doc) => {
    const abs = requireAbsolute(documentPath)
    let changed = 0
    for (const entry of doc.entries) {
      const resolved = resolveVirtualFolderEntryPath(abs, entry)
      for (const { from, to } of renames) {
        if (samePath(resolved, from)) {
          const stored = chooseVirtualFolderStoredPath(abs, requireAbsolute(to))
          entry.path = stored.path
          entry.relative = stored.relative
          changed++
          break
        }
      }
    }
    return { added: changed } as VirtualFolderMutateResponse
  })
}

export { virtualFolderDisplayName, virtualFolderDocumentDir, isVirtualFolderDocumentPath }
