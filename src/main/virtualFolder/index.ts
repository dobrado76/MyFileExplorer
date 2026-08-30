import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '@shared/result'
import {
  VIRTUAL_FOLDER_EXT,
  chooseVirtualFolderStoredPath,
  cloneVirtualFolderEntries,
  emptyVirtualFolderDocument,
  entryDisplayName,
  findEntryInTree,
  getEntriesAtGroup,
  inferVirtualFolderEntryKind,
  isEmbeddedVirtualFolderGroup,
  isExternalVirtualFolderLink,
  isVirtualFolderDocumentPath,
  mapEntriesAtGroup,
  newVirtualFolderEntryId,
  nextEmbeddedGroupLabel,
  nextVirtualFolderFileName,
  rebaseVirtualFolderEntriesToDocument,
  virtualFolderDisplayName,
  virtualFolderDocumentDir,
  virtualFolderDocumentPathFromProjectedMount,
  virtualFolderEntryDuplicateKey,
  virtualFolderGroupRowPath,
  resolveVirtualFolderEntryPath,
  serializeVirtualFolderDocument,
  takeEntriesFromTree,
  isVirtualFolderGroupAncestor,
  walkVirtualFolderEntries,
  type VirtualFolderDocument,
  type VirtualFolderEntry,
  type VirtualFolderMembership
} from '@shared/virtualFolder'
import { parseVirtualFolderJson } from '@shared/schemas/virtualFolder'
import type {
  VirtualFolderCreateGroupResponse,
  VirtualFolderListItem,
  VirtualFolderListResponse,
  VirtualFolderMutateResponse,
  VirtualFolderPreviewStats
} from '@shared/schemas/virtualFolder'
import type { DirEntry } from '@shared/schemas/fs'
import { samePath } from '@shared/paths'
import { requireAbsolute } from '../fs/list'
import { pathIsReadOnly } from '../fs/winAttrs'
import { applyVirtualFolderDocumentHiddenAttribute } from './documentHiddenAttr'

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

function cloneEntries(entries: VirtualFolderEntry[]): VirtualFolderEntry[] {
  return cloneVirtualFolderEntries(entries)
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
  // Windows: keep the definition file Hidden so Explorer (default) shows only the
  // projected sibling folder when OS projection is on (D67 / D68).
  applyVirtualFolderDocumentHiddenAttribute(abs)
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
  if (isEmbeddedVirtualFolderGroup(entry)) {
    const name = entryDisplayName(entry)
    const rowPath = virtualFolderGroupRowPath(documentPath, entry.id)
    const membership: VirtualFolderMembership = {
      entryId: entry.id,
      virtualFolderPath: documentPath,
      storedPath: '',
      resolvedPath: null,
      expectedKind: 'virtualFolder',
      state: 'resolved',
      label: name,
      embeddedGroup: true
    }
    const dirEntry: DirEntry = {
      name,
      path: rowPath,
      kind: 'dir',
      size: 0,
      mtimeMs: 0,
      birthtimeMs: 0,
      ext: VIRTUAL_FOLDER_EXT.slice(1),
      isHidden: false
    }
    return { membership, dirEntry }
  }

  const storedPath = entry.path ?? ''
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

  if (isExternalVirtualFolderLink(entry) || (state === 'resolved' && isVirtualFolderDocumentPath(resolved))) {
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

export async function listVirtualFolder(
  documentPath: string,
  groupId?: string | null
): Promise<VirtualFolderListResponse> {
  const abs = requireAbsolute(documentPath)
  const loaded = await readDocumentFile(abs)
  const effectiveGroup = groupId && groupId.length > 0 ? groupId : null
  const level = getEntriesAtGroup(loaded.document.entries, effectiveGroup)
  if (level == null) {
    throw new AppError('not-found', 'Virtual Folder group not found', undefined, abs)
  }
  const items: VirtualFolderListItem[] = []
  const CONCURRENCY = 32
  for (let i = 0; i < level.length; i += CONCURRENCY) {
    const batch = level.slice(i, i + CONCURRENCY)
    const rows = await Promise.all(batch.map((e) => resolveMembership(abs, e)))
    items.push(...rows.map((r) => ({ entry: r.dirEntry, membership: r.membership })))
  }
  return {
    path: abs,
    document: loaded.document,
    mtimeMs: loaded.mtimeMs,
    readOnly: !(await isWritableFile(abs)),
    entries: items,
    warnings: loaded.warnings,
    groupId: effectiveGroup
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
  let entryCount = 0
  const locationKeys = new Set<string>()
  const locationSamples: string[] = []

  walkVirtualFolderEntries(loaded.document.entries, (entry) => {
    entryCount++
    if (entry.kind === 'virtualFolder') {
      virtualFolderCount++
      return
    }
    if (entry.kind === 'folder') folderCount++
    else fileCount++

    const resolved = resolveVirtualFolderEntryPath(abs, entry)
    if (!resolved) {
      missingCount++
      return
    }
    try {
      const st = fs.statSync(resolved)
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
  })

  return {
    entryCount,
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
  let siblings: string[]
  try {
    siblings = await fsp.readdir(dir)
  } catch (e) {
    throw new AppError(
      'io',
      `Cannot read folder “${dir}”: ${e instanceof Error ? e.message : String(e)}`,
      undefined,
      dir
    )
  }
  const fileName = nextVirtualFolderFileName(base, siblings)
  const dest = path.join(dir, fileName)
  const document = emptyVirtualFolderDocument()
  const mtimeMs = await atomicWriteDocument(dest, document)
  return { path: dest, document, mtimeMs }
}

export async function createVirtualFolderGroup(
  documentPath: string,
  opts?: { parentGroupId?: string; name?: string; expectedMtimeMs?: number }
): Promise<VirtualFolderCreateGroupResponse> {
  const abs = requireAbsolute(documentPath)
  const parentGroupId = opts?.parentGroupId
  let entryId = ''
  let rowPath = ''
  const result = await mutateDocument(abs, opts?.expectedMtimeMs, (doc) => {
    const siblings = getEntriesAtGroup(doc.entries, parentGroupId ?? null)
    if (siblings == null) {
      throw new AppError('not-found', 'Virtual Folder group not found', undefined, abs)
    }
    const label = nextEmbeddedGroupLabel(opts?.name ?? 'New Virtual Folder', siblings)
    entryId = newVirtualFolderEntryId()
    const group: VirtualFolderEntry = {
      id: entryId,
      kind: 'virtualFolder',
      label,
      children: []
    }
    const ok = mapEntriesAtGroup(doc.entries, parentGroupId ?? null, (list) => [...list, group])
    if (!ok) throw new AppError('not-found', 'Virtual Folder group not found', undefined, abs)
    rowPath = virtualFolderGroupRowPath(abs, entryId)
  })
  return { ...result, entryId, rowPath }
}

async function mutateDocument(
  documentPath: string,
  expectedMtimeMs: number | undefined,
  mutator: (
    doc: VirtualFolderDocument
  ) => Partial<Pick<VirtualFolderMutateResponse, 'added' | 'skippedDuplicates' | 'removed'>> | void
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
    entries: cloneEntries(loaded.document.entries),
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
  expectedMtimeMs?: number,
  groupId?: string | null
): Promise<VirtualFolderMutateResponse> {
  const abs = requireAbsolute(documentPath)
  type Prepared =
    | { kind: 'ref'; target: string }
    | {
        kind: 'absorb'
        label: string
        children: VirtualFolderEntry[]
      }
  const prepared: Prepared[] = []
  for (const raw of paths) {
    const target = await coerceVirtualFolderDocumentPath(raw)
    if (isVirtualFolderDocumentPath(target)) {
      if (samePath(target, abs)) {
        throw new AppError(
          'validation',
          'Cannot absorb a Virtual Folder into itself',
          undefined,
          abs
        )
      }
      const loaded = await readDocumentFile(target)
      prepared.push({
        kind: 'absorb',
        label: virtualFolderDisplayName(target),
        children: rebaseVirtualFolderEntriesToDocument(
          target,
          abs,
          cloneEntries(loaded.document.entries)
        )
      })
      continue
    }
    prepared.push({ kind: 'ref', target })
  }
  return mutateDocument(abs, expectedMtimeMs, (doc) => {
    const level = getEntriesAtGroup(doc.entries, groupId ?? null)
    if (level == null) {
      throw new AppError('not-found', 'Virtual Folder group not found', undefined, abs)
    }
    const existing = new Set(
      level
        .filter((e) => e.path)
        .map((e) => virtualFolderEntryDuplicateKey(abs, e as { path: string; relative?: boolean }))
    )
    let added = 0
    let skippedDuplicates = 0
    const toAdd: VirtualFolderEntry[] = []
    const siblingLabels = [...level]
    for (const item of prepared) {
      if (item.kind === 'absorb') {
        const label = nextEmbeddedGroupLabel(item.label, [...siblingLabels, ...toAdd])
        toAdd.push({
          id: newVirtualFolderEntryId(),
          kind: 'virtualFolder',
          label,
          children: item.children
        })
        added++
        continue
      }
      const target = item.target
      const stored = chooseVirtualFolderStoredPath(abs, target)
      const key = virtualFolderEntryDuplicateKey(abs, stored)
      if (existing.has(key)) {
        skippedDuplicates++
        continue
      }
      let kind = inferVirtualFolderEntryKind(null, target)
      try {
        const st = fs.statSync(target)
        kind = inferVirtualFolderEntryKind(st.isDirectory() ? 'dir' : 'file', target)
      } catch {
        /* keep path-based inference */
      }
      toAdd.push({
        id: newVirtualFolderEntryId(),
        kind,
        path: stored.path,
        relative: stored.relative
      })
      existing.add(key)
      added++
    }
    mapEntriesAtGroup(doc.entries, groupId ?? null, (list) => [...list, ...toAdd])
    return { added, skippedDuplicates }
  })
}

async function unprojectDocument(documentPath: string): Promise<void> {
  if (process.platform !== 'win32') return
  const abs = requireAbsolute(documentPath)
  const { projectionUnmount, projectionUnmountBestEffort } = await import('./projectionClient')
  try {
    await projectionUnmount(abs)
  } catch {
    await projectionUnmountBestEffort(abs)
  }
}

async function unprojectAndDeleteDocument(documentPath: string): Promise<void> {
  const abs = requireAbsolute(documentPath)
  await unprojectDocument(abs)
  // WinFsp can briefly keep the reparse point busy after unmount.
  let lastErr: unknown
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((r) => setTimeout(r, 40 * attempt))
      await unprojectDocument(abs)
    } else {
      await new Promise<void>((r) => setTimeout(r, 40))
    }
    try {
      await fsp.unlink(abs)
      return
    } catch (e) {
      lastErr = e
      try {
        await fsp.access(abs)
      } catch {
        // Already gone (unlinked by another path / race).
        return
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new AppError('io', `Cannot delete Virtual Folder “${abs}”`, undefined, abs)
}

/**
 * If `path` is a projected mount folder, return the sibling `.mfevirtual` when it exists.
 */
async function coerceVirtualFolderDocumentPath(pathLike: string): Promise<string> {
  const abs = requireAbsolute(pathLike)
  if (isVirtualFolderDocumentPath(abs)) return abs
  const asDoc = requireAbsolute(virtualFolderDocumentPathFromProjectedMount(abs))
  try {
    await fsp.access(asDoc)
    return asDoc
  } catch {
    return abs
  }
}

/**
 * Spawn a standalone `.mfevirtual` from an embedded group into a real folder.
 * Move removes the group from the source document; copy leaves it.
 */
export async function extractVirtualFolderGroupToDocument(
  sourceDocumentPath: string,
  groupId: string,
  destParentDir: string,
  opts?: {
    removeFromSource?: boolean
    expectedMtimeMs?: number
    name?: string
  }
): Promise<{
  path: string
  document: VirtualFolderDocument
  mtimeMs: number
  sourceMtimeMs?: number
  sourceDocument?: VirtualFolderDocument
}> {
  const sourceAbs = requireAbsolute(sourceDocumentPath)
  const destDir = requireAbsolute(destParentDir)
  const loaded = await readDocumentFile(sourceAbs)
  assertExpectedMtime(loaded.mtimeMs, opts?.expectedMtimeMs)
  const group = findEntryInTree(loaded.document.entries, groupId)
  if (!group || !isEmbeddedVirtualFolderGroup(group)) {
    throw new AppError('not-found', 'Virtual Folder group not found', undefined, sourceAbs)
  }
  const baseName =
    [...(opts?.name ?? entryDisplayName(group))]
      .filter((ch) => {
        const c = ch.charCodeAt(0)
        if (c < 32) return false
        return !'<>:"/\\|?*'.includes(ch)
      })
      .join('')
      .trim() || 'New Virtual Folder'
  let siblings: string[]
  try {
    siblings = await fsp.readdir(destDir)
  } catch (e) {
    throw new AppError(
      'io',
      `Cannot read folder “${destDir}”: ${e instanceof Error ? e.message : String(e)}`,
      undefined,
      destDir
    )
  }
  const fileName = nextVirtualFolderFileName(baseName, siblings)
  const destPath = path.join(destDir, fileName)
  const now = new Date().toISOString()
  const document: VirtualFolderDocument = {
    ...emptyVirtualFolderDocument(now),
    settings: loaded.document.settings ? { ...loaded.document.settings } : { manualOrder: true },
    entries: rebaseVirtualFolderEntriesToDocument(
      sourceAbs,
      destPath,
      cloneEntries(group.children ?? [])
    )
  }
  const mtimeMs = await atomicWriteDocument(destPath, document)

  let sourceMtimeMs: number | undefined
  let sourceDocument: VirtualFolderDocument | undefined
  if (opts?.removeFromSource === true) {
    if (!(await isWritableFile(sourceAbs))) {
      throw new AppError('not-allowed', 'Virtual Folder is read-only', undefined, sourceAbs)
    }
    const result = await mutateDocument(sourceAbs, opts?.expectedMtimeMs, (doc) => {
      const removed = removeIdsFromTree(doc.entries, new Set([groupId]))
      return { removed }
    })
    sourceMtimeMs = result.mtimeMs
    sourceDocument = result.document
  }

  return { path: destPath, document, mtimeMs, sourceMtimeMs, sourceDocument }
}

function removeIdsFromTree(entries: VirtualFolderEntry[], idSet: Set<string>): number {
  let removed = 0
  const next: VirtualFolderEntry[] = []
  for (const e of entries) {
    if (idSet.has(e.id)) {
      removed++
      continue
    }
    if (e.children) {
      removed += removeIdsFromTree(e.children, idSet)
    }
    next.push(e)
  }
  entries.length = 0
  entries.push(...next)
  return removed
}

export async function removeVirtualFolderEntries(
  documentPath: string,
  entryIds: string[],
  expectedMtimeMs?: number
): Promise<VirtualFolderMutateResponse> {
  const idSet = new Set(entryIds)
  return mutateDocument(documentPath, expectedMtimeMs, (doc) => {
    const removed = removeIdsFromTree(doc.entries, idSet)
    return { removed }
  })
}

/**
 * Absorb a standalone `.mfevirtual` into another document as an embedded group.
 * When `deleteSource` is true, the source is unprojected first (so the sibling
 * mount does not linger), then absorbed, then the `.mfevirtual` file is deleted.
 */
export async function absorbVirtualFolderDocument(
  sourceDocumentPath: string,
  destDocumentPath: string,
  destGroupId?: string | null,
  opts?: { deleteSource?: boolean; expectedMtimeMs?: number }
): Promise<
  VirtualFolderMutateResponse & {
    entryId: string
    rowPath: string
    deletedSourcePath?: string
  }
> {
  const sourceAbs = await coerceVirtualFolderDocumentPath(sourceDocumentPath)
  const destAbs = requireAbsolute(destDocumentPath)
  if (!isVirtualFolderDocumentPath(sourceAbs)) {
    throw new AppError(
      'validation',
      'Not a Virtual Folder document',
      undefined,
      requireAbsolute(sourceDocumentPath)
    )
  }
  if (samePath(sourceAbs, destAbs)) {
    throw new AppError(
      'validation',
      'Cannot absorb a Virtual Folder into itself',
      undefined,
      destAbs
    )
  }
  const loaded = await readDocumentFile(sourceAbs)
  const children = rebaseVirtualFolderEntriesToDocument(
    sourceAbs,
    destAbs,
    cloneEntries(loaded.document.entries)
  )
  const preferredLabel = virtualFolderDisplayName(sourceAbs)

  // Drop OS projection before rewriting membership so Movies\Name does not remain
  // as a ghost mount after the definition file is gone.
  if (opts?.deleteSource === true) {
    await unprojectDocument(sourceAbs)
  }

  let entryId = ''
  let rowPath = ''
  const result = await mutateDocument(destAbs, opts?.expectedMtimeMs, (doc) => {
    const siblings = getEntriesAtGroup(doc.entries, destGroupId ?? null)
    if (siblings == null) {
      throw new AppError('not-found', 'Virtual Folder group not found', undefined, destAbs)
    }
    entryId = newVirtualFolderEntryId()
    const label = nextEmbeddedGroupLabel(preferredLabel, siblings)
    const group: VirtualFolderEntry = {
      id: entryId,
      kind: 'virtualFolder',
      label,
      children
    }
    const ok = mapEntriesAtGroup(doc.entries, destGroupId ?? null, (list) => [...list, group])
    if (!ok) throw new AppError('not-found', 'Virtual Folder group not found', undefined, destAbs)
    rowPath = virtualFolderGroupRowPath(destAbs, entryId)
    return { added: 1 }
  })
  let deletedSourcePath: string | undefined
  if (opts?.deleteSource === true) {
    await unprojectAndDeleteDocument(sourceAbs)
    deletedSourcePath = sourceAbs
  }
  return { ...result, entryId, rowPath, deletedSourcePath }
}

/**
 * Copy or move an embedded group into a different Virtual Folder document.
 * Same-document moves should use `moveVirtualFolderEntries` instead.
 */
export async function transferVirtualFolderGroup(
  sourceDocumentPath: string,
  groupId: string,
  destDocumentPath: string,
  destGroupId?: string | null,
  opts?: {
    removeFromSource?: boolean
    expectedSourceMtimeMs?: number
    expectedDestMtimeMs?: number
  }
): Promise<{
  entryId: string
  rowPath: string
  dest: VirtualFolderMutateResponse
  source?: VirtualFolderMutateResponse
}> {
  const sourceAbs = requireAbsolute(sourceDocumentPath)
  const destAbs = requireAbsolute(destDocumentPath)
  const sameDoc = samePath(sourceAbs, destAbs)
  if (sameDoc && opts?.removeFromSource === true) {
    throw new AppError(
      'validation',
      'Use move within the same Virtual Folder document',
      undefined,
      destAbs
    )
  }
  const loaded = await readDocumentFile(sourceAbs)
  assertExpectedMtime(loaded.mtimeMs, opts?.expectedSourceMtimeMs)
  const group = findEntryInTree(loaded.document.entries, groupId)
  if (!group || !isEmbeddedVirtualFolderGroup(group)) {
    throw new AppError('not-found', 'Virtual Folder group not found', undefined, sourceAbs)
  }
  if (sameDoc && opts?.removeFromSource !== true) {
    // Duplicate within the same document (copy-drag).
    if (destGroupId && isVirtualFolderGroupAncestor(loaded.document.entries, groupId, destGroupId)) {
      throw new AppError(
        'validation',
        'Cannot copy a Virtual Folder into itself or a child of itself',
        undefined,
        destAbs
      )
    }
  }
  const children = rebaseVirtualFolderEntriesToDocument(
    sourceAbs,
    destAbs,
    cloneEntries(group.children ?? [])
  )
  const preferredLabel = entryDisplayName(group)
  let entryId = ''
  let rowPath = ''
  const dest = await mutateDocument(destAbs, opts?.expectedDestMtimeMs, (doc) => {
    const siblings = getEntriesAtGroup(doc.entries, destGroupId ?? null)
    if (siblings == null) {
      throw new AppError('not-found', 'Virtual Folder group not found', undefined, destAbs)
    }
    entryId = newVirtualFolderEntryId()
    const label = nextEmbeddedGroupLabel(preferredLabel, siblings)
    const nextGroup: VirtualFolderEntry = {
      id: entryId,
      kind: 'virtualFolder',
      label,
      children
    }
    const ok = mapEntriesAtGroup(doc.entries, destGroupId ?? null, (list) => [...list, nextGroup])
    if (!ok) throw new AppError('not-found', 'Virtual Folder group not found', undefined, destAbs)
    rowPath = virtualFolderGroupRowPath(destAbs, entryId)
    return { added: 1 }
  })
  let source: VirtualFolderMutateResponse | undefined
  if (opts?.removeFromSource === true) {
    source = await mutateDocument(sourceAbs, opts?.expectedSourceMtimeMs, (doc) => {
      const removed = removeIdsFromTree(doc.entries, new Set([groupId]))
      return { removed }
    })
  }
  return { entryId, rowPath, dest, source }
}

/**
 * Reparent entries (including whole embedded-group subtrees) within one document.
 * Used for cut/drag of Virtual Folder rows — never treats opaque group paths as files.
 */
export async function moveVirtualFolderEntries(
  documentPath: string,
  entryIds: string[],
  destGroupId: string | null | undefined,
  expectedMtimeMs?: number
): Promise<VirtualFolderMutateResponse> {
  const abs = requireAbsolute(documentPath)
  const dest = destGroupId && destGroupId.length > 0 ? destGroupId : null
  return mutateDocument(abs, expectedMtimeMs, (doc) => {
    for (const id of entryIds) {
      if (dest && isVirtualFolderGroupAncestor(doc.entries, id, dest)) {
        throw new AppError(
          'validation',
          'Cannot move a Virtual Folder into itself or a child of itself',
          undefined,
          abs
        )
      }
    }
    const destLevel = getEntriesAtGroup(doc.entries, dest)
    if (destLevel == null) {
      throw new AppError('not-found', 'Virtual Folder group not found', undefined, abs)
    }
    // Same-group no-op (already members of dest).
    const destIds = new Set(destLevel.map((e) => e.id))
    const toMove = entryIds.filter((id) => !destIds.has(id))
    if (toMove.length === 0) return { added: 0, removed: 0 }

    const taken = takeEntriesFromTree(doc.entries, toMove)
    if (taken.length === 0) return { added: 0, removed: 0 }

    const ok = mapEntriesAtGroup(doc.entries, dest, (list) => [...list, ...taken])
    if (!ok) throw new AppError('not-found', 'Virtual Folder group not found', undefined, abs)
    return { added: taken.length, removed: taken.length }
  })
}

export async function reorderVirtualFolderEntries(
  documentPath: string,
  entryIds: string[],
  expectedMtimeMs?: number,
  groupId?: string | null
): Promise<VirtualFolderMutateResponse> {
  return mutateDocument(documentPath, expectedMtimeMs, (doc) => {
    const ok = mapEntriesAtGroup(doc.entries, groupId ?? null, (list) => {
      const byId = new Map(list.map((e) => [e.id, e]))
      const next: VirtualFolderEntry[] = []
      for (const id of entryIds) {
        const e = byId.get(id)
        if (e) {
          next.push(e)
          byId.delete(id)
        }
      }
      for (const e of byId.values()) next.push(e)
      return next
    })
    if (!ok) throw new AppError('not-found', 'Virtual Folder group not found', undefined, documentPath)
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
    const entry = findEntryInTree(doc.entries, entryId)
    if (!entry) throw new AppError('not-found', 'Virtual Folder entry not found', undefined, abs)
    if (isEmbeddedVirtualFolderGroup(entry)) {
      throw new AppError('validation', 'Cannot relink an embedded Virtual Folder group', undefined, abs)
    }
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
    const entry = findEntryInTree(doc.entries, entryId)
    if (!entry) {
      throw new AppError('not-found', 'Virtual Folder entry not found', undefined, documentPath)
    }
    if (isEmbeddedVirtualFolderGroup(entry)) {
      const next = (label ?? '').trim() || 'Virtual Folder'
      entry.label = next
      return
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
    walkVirtualFolderEntries(doc.entries, (entry) => {
      if (!entry.path) return
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
    })
    return { added: changed } as VirtualFolderMutateResponse
  })
}

export { virtualFolderDisplayName, virtualFolderDocumentDir, isVirtualFolderDocumentPath }
