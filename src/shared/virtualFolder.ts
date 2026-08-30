/**
 * Virtual Folder (`.mfevirtual`) — portable folder-like collections of path references (D67).
 * Shared helpers only; no Node fs.
 */
import { isUnderPath, isVolumeRootPath, normalizeSlashes, pathKey, samePath, stripTrailingSep } from './paths'

export const VIRTUAL_FOLDER_EXT = '.mfevirtual'
export const VIRTUAL_FOLDER_FORMAT = 'MyFileExplorer.VirtualFolder'
export const VIRTUAL_FOLDER_VERSION = 1 as const

export type VirtualFolderEntryKind = 'file' | 'folder' | 'virtualFolder'

export type VirtualFolderSettings = {
  /** Preserve explicit entry order when Manual sort is selected. */
  manualOrder?: boolean
}

export type VirtualFolderEntry = {
  id: string
  kind: VirtualFolderEntryKind
  /**
   * Absolute (native) or relative (`/` separators when relative).
   * Omitted for embedded groups (`kind: virtualFolder` with `label` / `children`).
   * Present for legacy external Virtual Folder links.
   */
  path?: string
  /** true => path is relative to the `.mfevirtual` file's directory. */
  relative?: boolean
  /** Display name — required for embedded groups; optional override for refs. */
  label?: string
  note?: string
  /** Nested entries for an embedded Virtual Folder group. */
  children?: VirtualFolderEntry[]
}

export type VirtualFolderDocument = {
  format: typeof VIRTUAL_FOLDER_FORMAT
  version: typeof VIRTUAL_FOLDER_VERSION
  id: string
  created?: string
  modified?: string
  settings?: VirtualFolderSettings
  entries: VirtualFolderEntry[]
}

export type VirtualFolderResolveState = 'resolved' | 'missing' | 'inaccessible'

export type VirtualFolderMembership = {
  entryId: string
  virtualFolderPath: string
  storedPath: string
  resolvedPath: string | null
  expectedKind: VirtualFolderEntryKind
  state: VirtualFolderResolveState
  label?: string
  note?: string
  relative?: boolean
  /** True when this row is an embedded group (not a filesystem path). */
  embeddedGroup?: boolean
}

function basenameOf(nameOrPath: string): string {
  const n = nameOrPath.replace(/\//g, '\\')
  return n.slice(Math.max(n.lastIndexOf('\\'), n.lastIndexOf('/')) + 1)
}

function extOfBase(base: string): string {
  const d = base.lastIndexOf('.')
  return d > 0 ? base.slice(d).toLowerCase() : ''
}

/** True when the path's extension is `.mfevirtual`. */
export function isVirtualFolderExt(nameOrPath: string): boolean {
  return extOfBase(basenameOf(nameOrPath)) === VIRTUAL_FOLDER_EXT
}

/** Document path (absolute) whose basename is a Virtual Folder file. */
export function isVirtualFolderDocumentPath(p: string): boolean {
  if (!p || p.toLowerCase().startsWith('mfe-remote://')) return false
  return isVirtualFolderExt(p)
}

/** Display title derived from the document filename (no extension). */
export function virtualFolderDisplayName(documentPath: string): string {
  const n = stripTrailingSep(normalizeSlashes(documentPath))
  const base = basenameOf(n)
  const lower = base.toLowerCase()
  if (lower.endsWith(VIRTUAL_FOLDER_EXT)) {
    return base.slice(0, -VIRTUAL_FOLDER_EXT.length) || base
  }
  return base || documentPath
}

/** Parent directory of the Virtual Folder document (native separators). */
export function virtualFolderDocumentDir(documentPath: string): string {
  const n = stripTrailingSep(normalizeSlashes(documentPath))
  const i = Math.max(n.lastIndexOf('\\'), n.lastIndexOf('/'))
  if (i <= 0) {
    if (/^[a-zA-Z]:$/i.test(n)) return n + '\\'
    return n
  }
  const parent = n.slice(0, i)
  if (/^[a-zA-Z]:$/i.test(parent)) return parent + '\\'
  return parent || n
}

/**
 * Prefer relative when target is under the document's directory tree;
 * otherwise absolute. Relative paths use `/`.
 */
export function chooseVirtualFolderStoredPath(
  documentPath: string,
  targetPath: string
): { path: string; relative: boolean } {
  const docDir = virtualFolderDocumentDir(documentPath)
  if (isUnderPath(targetPath, docDir) && !samePath(targetPath, docDir)) {
    const abs = stripTrailingSep(normalizeSlashes(targetPath))
    const root = stripTrailingSep(normalizeSlashes(docDir))
    let rel = abs.slice(root.length).replace(/^\\+/, '')
    rel = rel.replace(/\\/g, '/')
    return { path: rel, relative: true }
  }
  return { path: stripTrailingSep(normalizeSlashes(targetPath)), relative: false }
}

/** Resolve an entry path against the document directory. */
export function resolveVirtualFolderEntryPath(
  documentPath: string,
  entry: Pick<VirtualFolderEntry, 'path' | 'relative'>
): string {
  const raw = (entry.path ?? '').trim()
  if (!raw) return ''
  if (entry.relative) {
    const docDir = virtualFolderDocumentDir(documentPath)
    const parts = raw.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.')
    let base = stripTrailingSep(normalizeSlashes(docDir))
    for (const part of parts) {
      if (part === '..') {
        if (isVolumeRootPath(base)) continue
        const i = Math.max(base.lastIndexOf('\\'), base.lastIndexOf('/'))
        if (i > 0) {
          const next = base.slice(0, i)
          base = /^[a-zA-Z]:$/i.test(next) ? next + '\\' : next
        }
        continue
      }
      const root = stripTrailingSep(base).replace(/\\+$/, '')
      base = `${root}\\${part}`
    }
    return base
  }
  return stripTrailingSep(normalizeSlashes(raw))
}

/** Canonical key for duplicate detection (resolved absolute path). */
export function virtualFolderEntryDuplicateKey(
  documentPath: string,
  entry: Pick<VirtualFolderEntry, 'path' | 'relative'>
): string {
  return pathKey(resolveVirtualFolderEntryPath(documentPath, entry))
}

/** Embedded group (in-document nested VF) — not an external `.mfevirtual` link. */
export function isEmbeddedVirtualFolderGroup(
  entry: Pick<VirtualFolderEntry, 'kind' | 'path' | 'children' | 'label'>
): boolean {
  if (normalizeVirtualFolderEntryKind(entry.kind) !== 'virtualFolder') return false
  const hasPath = typeof entry.path === 'string' && entry.path.trim().length > 0
  if (hasPath) return false
  return true
}

/** Legacy external link to another `.mfevirtual` document. */
export function isExternalVirtualFolderLink(
  entry: Pick<VirtualFolderEntry, 'kind' | 'path'>
): boolean {
  if (normalizeVirtualFolderEntryKind(entry.kind) !== 'virtualFolder') return false
  return typeof entry.path === 'string' && entry.path.trim().length > 0
}

export const VF_GROUP_PATH_PREFIX = 'mfe-vfgroup:'

/** Opaque selection/tree path for an embedded group row (not a filesystem path). */
export function virtualFolderGroupRowPath(documentPath: string, groupId: string): string {
  return `${VF_GROUP_PATH_PREFIX}${encodeURIComponent(documentPath)}|${encodeURIComponent(groupId)}`
}

export function isVirtualFolderGroupPath(p: string): boolean {
  return typeof p === 'string' && p.startsWith(VF_GROUP_PATH_PREFIX)
}

export function parseVirtualFolderGroupPath(
  p: string
): { documentPath: string; groupId: string } | null {
  if (!isVirtualFolderGroupPath(p)) return null
  const rest = p.slice(VF_GROUP_PATH_PREFIX.length)
  const bar = rest.indexOf('|')
  if (bar < 0) return null
  try {
    const documentPath = decodeURIComponent(rest.slice(0, bar))
    // Tolerate a accidental extra `|` (e.g. `doc||id`) from older path builders.
    const groupId = decodeURIComponent(rest.slice(bar + 1).replace(/^\|+/, ''))
    if (!documentPath || !groupId) return null
    return { documentPath, groupId }
  } catch {
    return null
  }
}

/**
 * Resolve a Virtual Folder entry id from a selection path.
 * Prefers the listing side-map; falls back to parsing opaque group rows
 * (needed when deleting/moving a group from the tree while that group is the cwd).
 */
export function virtualFolderEntryIdFromPath(
  p: string,
  entryIdByPathKey?: Record<string, string> | null
): string | null {
  if (entryIdByPathKey) {
    const fromMap = entryIdByPathKey[pathKey(p)]
    if (fromMap) return fromMap
    // Opaque paths must not go through win-path normalization for lookup mismatch;
    // try the raw key and a lowercased opaque key too.
    if (isVirtualFolderGroupPath(p)) {
      const raw = entryIdByPathKey[p] ?? entryIdByPathKey[p.toLowerCase()]
      if (raw) return raw
    }
  }
  return parseVirtualFolderGroupPath(p)?.groupId ?? null
}

/** True if `ancestorId` is `entryId` or an ancestor group of it. */
export function isVirtualFolderGroupAncestor(
  entries: readonly VirtualFolderEntry[],
  ancestorId: string,
  entryId: string
): boolean {
  if (ancestorId === entryId) return true
  let cur: string | null | undefined = entryId
  const guard = new Set<string>()
  while (cur) {
    if (guard.has(cur)) return false
    guard.add(cur)
    if (cur === ancestorId) return true
    cur = findParentGroupId(entries, cur)
    if (cur === null) return false
  }
  return false
}

/**
 * Detach entries by id (keeping each subtree intact). Returns detached nodes in
 * the order `entryIds` were requested (missing ids skipped).
 */
export function takeEntriesFromTree(
  entries: VirtualFolderEntry[],
  entryIds: readonly string[]
): VirtualFolderEntry[] {
  const idSet = new Set(entryIds)
  const taken = new Map<string, VirtualFolderEntry>()
  const strip = (list: VirtualFolderEntry[]): VirtualFolderEntry[] => {
    const next: VirtualFolderEntry[] = []
    for (const e of list) {
      if (idSet.has(e.id)) {
        taken.set(e.id, e)
        continue
      }
      if (e.children) e.children = strip(e.children)
      next.push(e)
    }
    return next
  }
  const remaining = strip(entries)
  entries.length = 0
  entries.push(...remaining)
  const out: VirtualFolderEntry[] = []
  for (const id of entryIds) {
    const e = taken.get(id)
    if (e) out.push(e)
  }
  return out
}

export function entryDisplayName(
  entry: Pick<VirtualFolderEntry, 'path' | 'label' | 'relative'> &
    Partial<Pick<VirtualFolderEntry, 'kind'>>,
  resolvedBasename?: string
): string {
  if (entry.label?.trim()) return entry.label.trim()
  if (resolvedBasename) return resolvedBasename
  const p = (entry.path ?? '').replace(/\\/g, '/')
  if (!p) return entry.kind === 'virtualFolder' ? 'Virtual Folder' : ''
  const base = p.slice(p.lastIndexOf('/') + 1)
  return base || entry.path || ''
}

/** Depth-first walk of all entries including embedded children. */
export function walkVirtualFolderEntries(
  entries: readonly VirtualFolderEntry[],
  visit: (entry: VirtualFolderEntry, parentGroupId: string | null) => void,
  parentGroupId: string | null = null
): void {
  for (const entry of entries) {
    visit(entry, parentGroupId)
    if (entry.children && entry.children.length > 0) {
      walkVirtualFolderEntries(entry.children, visit, entry.id)
    }
  }
}

/** Deep clone of an entry list (new object graph; ids preserved). */
export function cloneVirtualFolderEntries(
  entries: readonly VirtualFolderEntry[]
): VirtualFolderEntry[] {
  return entries.map((e) => ({
    ...e,
    children: e.children ? cloneVirtualFolderEntries(e.children) : undefined
  }))
}

/**
 * Re-store entry paths for a different document directory (relative vs absolute).
 * Embedded groups keep structure; only `path`/`relative` on leaf refs and legacy links change.
 */
export function rebaseVirtualFolderEntriesToDocument(
  fromDocumentPath: string,
  toDocumentPath: string,
  entries: readonly VirtualFolderEntry[]
): VirtualFolderEntry[] {
  if (samePath(fromDocumentPath, toDocumentPath)) {
    return cloneVirtualFolderEntries(entries)
  }
  const walk = (list: readonly VirtualFolderEntry[]): VirtualFolderEntry[] =>
    list.map((e) => {
      const next: VirtualFolderEntry = { ...e }
      if (next.children) next.children = walk(next.children)
      if (typeof next.path === 'string' && next.path.trim()) {
        const resolved = resolveVirtualFolderEntryPath(fromDocumentPath, next)
        if (resolved) {
          const stored = chooseVirtualFolderStoredPath(toDocumentPath, resolved)
          next.path = stored.path
          next.relative = stored.relative
        }
      }
      return next
    })
  return walk(entries)
}

/** Find an entry by id anywhere in the tree. */
export function findEntryInTree(
  entries: readonly VirtualFolderEntry[],
  entryId: string
): VirtualFolderEntry | null {
  for (const entry of entries) {
    if (entry.id === entryId) return entry
    if (entry.children) {
      const found = findEntryInTree(entry.children, entryId)
      if (found) return found
    }
  }
  return null
}

/**
 * Parent embedded-group id for `entryId`, or `null` if it lives at document root.
 * Returns `undefined` if the id is not in the tree.
 */
export function findParentGroupId(
  entries: readonly VirtualFolderEntry[],
  entryId: string,
  parentGroupId: string | null = null
): string | null | undefined {
  for (const entry of entries) {
    if (entry.id === entryId) return parentGroupId
    if (entry.children) {
      const found = findParentGroupId(entry.children, entryId, entry.id)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/** Tree / list cache key for a Virtual Folder level (`groupId` null = document root). */
export function virtualFolderTreeListPath(
  documentPath: string,
  groupId: string | null | undefined
): string {
  if (groupId) return virtualFolderGroupRowPath(documentPath, groupId)
  return documentPath
}

/**
 * Drop/paste target for the *currently open* Virtual Folder view.
 * Document path alone always means root; pass the open group id when browsed into one.
 */
export function virtualFolderOpenCwdPath(
  documentPath: string,
  groupId: string | null | undefined
): string {
  return virtualFolderTreeListPath(documentPath, groupId)
}

/**
 * Entries listed at a group level. `groupId` null = document root.
 * Returns null if `groupId` is set but not found / not an embedded group.
 */
export function getEntriesAtGroup(
  entries: readonly VirtualFolderEntry[],
  groupId: string | null | undefined
): VirtualFolderEntry[] | null {
  if (groupId == null || groupId === '') return [...entries]
  const group = findEntryInTree(entries, groupId)
  if (!group || !isEmbeddedVirtualFolderGroup(group)) return null
  return [...(group.children ?? [])]
}

/** Mutate the children array at `groupId` (null = root). Returns false if group missing. */
export function mapEntriesAtGroup(
  entries: VirtualFolderEntry[],
  groupId: string | null | undefined,
  mapper: (list: VirtualFolderEntry[]) => VirtualFolderEntry[]
): boolean {
  if (groupId == null || groupId === '') {
    const next = mapper(entries)
    entries.length = 0
    entries.push(...next)
    return true
  }
  const group = findEntryInTree(entries, groupId)
  if (!group || !isEmbeddedVirtualFolderGroup(group)) return false
  group.children = mapper([...(group.children ?? [])])
  return true
}

/** Unique label among sibling entries at a group (for New Virtual Folder). */
export function nextEmbeddedGroupLabel(
  preferred: string,
  siblings: readonly VirtualFolderEntry[]
): string {
  const base = preferred.trim() || 'New Virtual Folder'
  const used = new Set(
    siblings
      .map((e) => entryDisplayName(e).toLowerCase())
      .filter((n) => n.length > 0)
  )
  if (!used.has(base.toLowerCase())) return base
  let n = 2
  while (n < 10_000) {
    const candidate = `${base} (${n})`
    if (!used.has(candidate.toLowerCase())) return candidate
    n++
  }
  return `${base} (${Date.now()})`
}

export function emptyVirtualFolderDocument(nowIso = new Date().toISOString()): VirtualFolderDocument {
  return {
    format: VIRTUAL_FOLDER_FORMAT,
    version: VIRTUAL_FOLDER_VERSION,
    id: cryptoRandomId(),
    created: nowIso,
    modified: nowIso,
    settings: { manualOrder: true },
    entries: []
  }
}

export function newVirtualFolderEntryId(): string {
  return cryptoRandomId()
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Infer entry kind from a filesystem kind + path. */
export function inferVirtualFolderEntryKind(
  fsKind: 'file' | 'dir' | 'symlink' | null | undefined,
  targetPath: string
): VirtualFolderEntryKind {
  if (isVirtualFolderDocumentPath(targetPath)) return 'virtualFolder'
  if (fsKind === 'dir') return 'folder'
  return 'file'
}

/** Accept a known Virtual Folder entry kind string. */
export function normalizeVirtualFolderEntryKind(kind: string): VirtualFolderEntryKind | null {
  if (kind === 'file' || kind === 'folder' || kind === 'virtualFolder') return kind
  return null
}

/**
 * Present a Virtual Folder document as a folder-like DirEntry in listings/tree
 * (kind dir, ext mfevirtual). Call after building a normal file row.
 */
export function presentVirtualFolderAsDirEntry<
  T extends {
    name: string
    path: string
    kind: string
    size: number
    ext: string
    isHidden?: boolean
  }
>(entry: T): T {
  if (!isVirtualFolderExt(entry.name) && !isVirtualFolderDocumentPath(entry.path)) return entry
  return {
    ...entry,
    kind: 'dir',
    size: 0,
    ext: VIRTUAL_FOLDER_EXT.slice(1),
    // FILE_ATTRIBUTE_HIDDEN on disk is for Explorer only (projected sibling).
    // MFE always lists Virtual Folders as normal visible folders.
    isHidden: false
  }
}

/**
 * Deterministic JSON for Git-friendly diffs: 2-space indent, stable key order,
 * LF newlines, trailing newline.
 */
export function serializeVirtualFolderDocument(doc: VirtualFolderDocument): string {
  const body = stableStringify(doc, 2)
  return body.endsWith('\n') ? body : body + '\n'
}

function stableStringify(value: unknown, space: number): string {
  return JSON.stringify(sortKeysDeep(value), null, space)
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeysDeep(obj[key])
    }
    return out
  }
  return value
}

/**
 * Cycle guard for recursive Virtual Folder walks (nested `.mfevirtual` refs).
 * Returns null when `documentPath` was already visited.
 */
export function beginVirtualFolderVisit(
  documentPath: string,
  visited: Set<string>
): string | null {
  const key = pathKey(documentPath)
  if (visited.has(key)) return null
  visited.add(key)
  return key
}

/**
 * Stem used for in-place OS projection: `Name.mfevirtual` → `Name`.
 * Also the display name of the Virtual Folder file.
 */
export function virtualFolderStemFromFileName(fileName: string): string {
  const base = basenameOf(fileName)
  const lower = base.toLowerCase()
  if (lower.endsWith(VIRTUAL_FOLDER_EXT)) {
    return base.slice(0, -VIRTUAL_FOLDER_EXT.length) || base
  }
  return base
}

/**
 * Sibling path where OS projection would mount (`…\Name` next to `…\Name.mfevirtual`).
 * Pure path helper — does not touch the filesystem.
 */
export function virtualFolderProjectedMountPath(documentPath: string): string {
  const dir = virtualFolderDocumentDir(documentPath)
  const stem = virtualFolderStemFromFileName(basenameOf(documentPath))
  const root = stripTrailingSep(normalizeSlashes(dir))
  if (/^[a-zA-Z]:$/i.test(root)) return `${root}\\${stem}`
  return `${root}\\${stem}`
}

/**
 * Inverse of {@link virtualFolderProjectedMountPath}: projected `…\Name` → `…\Name.mfevirtual`.
 */
export function virtualFolderDocumentPathFromProjectedMount(mountPath: string): string {
  return stripTrailingSep(normalizeSlashes(mountPath)) + VIRTUAL_FOLDER_EXT
}

/**
 * Names that would collide with stem `stem` in a parent directory listing.
 * Pure helper for create/rename clash checks (no fs).
 *
 * - Creating/renaming a Virtual Folder to `Stem.mfevirtual` conflicts if `Stem` exists
 *   (folder or file) or another `Stem.mfevirtual` exists.
 * - Creating/renaming a real folder to `Stem` conflicts if `Stem.mfevirtual` exists.
 */
export function virtualFolderStemOccupants(
  stem: string,
  siblingNames: readonly string[],
  opts?: { ignoreNames?: readonly string[] }
): { conflictsWithFolderOrFile: boolean; conflictsWithVirtualFolder: boolean } {
  const want = stem.trim()
  if (!want) {
    return { conflictsWithFolderOrFile: false, conflictsWithVirtualFolder: false }
  }
  const wantKey = want.toLowerCase()
  const ignore = new Set(
    (opts?.ignoreNames ?? []).map((n) => basenameOf(n).toLowerCase())
  )
  let conflictsWithFolderOrFile = false
  let conflictsWithVirtualFolder = false
  for (const raw of siblingNames) {
    const name = basenameOf(raw)
    if (!name || ignore.has(name.toLowerCase())) continue
    if (isVirtualFolderExt(name)) {
      if (virtualFolderStemFromFileName(name).toLowerCase() === wantKey) {
        conflictsWithVirtualFolder = true
      }
      continue
    }
    if (name.toLowerCase() === wantKey) {
      conflictsWithFolderOrFile = true
    }
  }
  return { conflictsWithFolderOrFile, conflictsWithVirtualFolder }
}

/** True when creating `stem.mfevirtual` would clash with an existing sibling. */
export function virtualFolderDocumentStemBlocked(
  stem: string,
  siblingNames: readonly string[],
  opts?: { ignoreNames?: readonly string[] }
): boolean {
  const o = virtualFolderStemOccupants(stem, siblingNames, opts)
  return o.conflictsWithFolderOrFile || o.conflictsWithVirtualFolder
}

/** True when creating/renaming a real folder `stem` would clash with `stem.mfevirtual`. */
export function realFolderStemBlockedByVirtualFolder(
  stem: string,
  siblingNames: readonly string[],
  opts?: { ignoreNames?: readonly string[] }
): boolean {
  return virtualFolderStemOccupants(stem, siblingNames, opts).conflictsWithVirtualFolder
}

/** Suggest next free Virtual Folder file name (`Stem.mfevirtual`, `Stem (2).mfevirtual`, …). */
export function nextVirtualFolderFileName(
  preferredStemOrFileName: string,
  siblingNames: readonly string[],
  opts?: { ignoreNames?: readonly string[] }
): string {
  const raw = preferredStemOrFileName.trim() || 'New Virtual Folder'
  const stem0 = virtualFolderStemFromFileName(
    raw.toLowerCase().endsWith(VIRTUAL_FOLDER_EXT) ? raw : `${raw}${VIRTUAL_FOLDER_EXT}`
  )
  let n = 0
  while (true) {
    const candidateStem = n === 0 ? stem0 : `${stem0} (${n + 1})`
    if (!virtualFolderDocumentStemBlocked(candidateStem, siblingNames, opts)) {
      return `${candidateStem}${VIRTUAL_FOLDER_EXT}`
    }
    n++
    if (n > 10_000) return `${stem0} (${Date.now()})${VIRTUAL_FOLDER_EXT}`
  }
}

/** Suggest next free real folder name that does not collide with a Virtual Folder stem. */
export function nextRealFolderName(
  preferredName: string,
  siblingNames: readonly string[],
  opts?: { ignoreNames?: readonly string[] }
): string {
  const base = preferredName.trim() || 'New Folder'
  const ignore = new Set((opts?.ignoreNames ?? []).map((n) => basenameOf(n).toLowerCase()))
  let n = 0
  while (true) {
    const candidate = n === 0 ? base : `${base} (${n + 1})`
    const taken = siblingNames.some((s) => {
      const b = basenameOf(s)
      if (ignore.has(b.toLowerCase())) return false
      return b.toLowerCase() === candidate.toLowerCase()
    })
    if (!taken && !realFolderStemBlockedByVirtualFolder(candidate, siblingNames, opts)) {
      return candidate
    }
    n++
    if (n > 10_000) return `${base} (${Date.now()})`
  }
}

/**
 * When `Name.mfevirtual` is present, hide a sibling directory named `Name`
 * (WinFsp OS projection mount — otherwise MFE shows the document and the mount twice).
 */
export function filterOutProjectedMountPeers<T extends { path: string; kind?: string }>(
  entries: T[]
): T[] {
  const vfStems = new Set<string>()
  for (const e of entries) {
    if (!isVirtualFolderDocumentPath(e.path)) continue
    vfStems.add(virtualFolderStemFromFileName(basenameOf(e.path)).toLowerCase())
  }
  if (vfStems.size === 0) return entries
  return entries.filter((e) => {
    if (isVirtualFolderDocumentPath(e.path)) return true
    if (e.kind != null && e.kind !== 'dir') return true
    const base = basenameOf(e.path)
    if (!base || isVirtualFolderExt(base)) return true
    return !vfStems.has(base.toLowerCase())
  })
}

/**
 * Legacy: external nested `.mfevirtual` path members may still sit as siblings on disk.
 * Hide those peers from the parent *directory* listing/tree while they remain members.
 * New nested Virtual Folders are embedded groups and never create sibling files.
 */
export function nestedVirtualFolderPeerKeysToHide(
  siblingDocumentPaths: readonly string[],
  resolveDoc: (documentPath: string) => { entries: VirtualFolderEntry[] } | null
): Set<string> {
  const hide = new Set<string>()
  const present = new Set(siblingDocumentPaths.map((p) => pathKey(p)))
  for (const docPath of siblingDocumentPaths) {
    const doc = resolveDoc(docPath)
    if (!doc) continue
    for (const entry of doc.entries) {
      if (!isExternalVirtualFolderLink(entry)) continue
      const resolved = resolveVirtualFolderEntryPath(docPath, entry)
      if (!isVirtualFolderDocumentPath(resolved)) continue
      if (samePath(resolved, docPath)) continue
      if (present.has(pathKey(resolved))) hide.add(pathKey(resolved))
    }
  }
  return hide
}

export function filterOutNestedVirtualFolderPeers<T extends { path: string }>(
  entries: T[],
  resolveDoc: (documentPath: string) => { entries: VirtualFolderEntry[] } | null
): T[] {
  const vfPaths = entries.filter((e) => isVirtualFolderDocumentPath(e.path)).map((e) => e.path)
  if (vfPaths.length < 2) return entries
  const hide = nestedVirtualFolderPeerKeysToHide(vfPaths, resolveDoc)
  if (hide.size === 0) return entries
  return entries.filter((e) => !hide.has(pathKey(e.path)))
}
