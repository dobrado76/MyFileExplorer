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
  /** Absolute (native) or relative (`/` separators when relative). */
  path: string
  /** true => path is relative to the `.mfevirtual` file's directory. */
  relative?: boolean
  label?: string
  note?: string
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
  const raw = entry.path.trim()
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

export function entryDisplayName(
  entry: Pick<VirtualFolderEntry, 'path' | 'label' | 'relative'>,
  resolvedBasename?: string
): string {
  if (entry.label?.trim()) return entry.label.trim()
  if (resolvedBasename) return resolvedBasename
  const p = entry.path.replace(/\\/g, '/')
  const base = p.slice(p.lastIndexOf('/') + 1)
  return base || entry.path
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
  }
>(entry: T): T {
  if (!isVirtualFolderExt(entry.name) && !isVirtualFolderDocumentPath(entry.path)) return entry
  return {
    ...entry,
    kind: 'dir',
    size: 0,
    ext: VIRTUAL_FOLDER_EXT.slice(1)
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
