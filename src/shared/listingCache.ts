import type { DriveTypeKind } from './networkPaths'
import { parseUnc } from './networkPaths'
import { formatRemoteLocation, isRemoteLocation, parseRemoteLocation } from './remotePaths'

/** Session-only remote folder snapshots (renderer). Not persisted. */
export const LISTING_CACHE_MAX_FOLDERS = 24
/** Skip / evict listings this large — painting 200k rows from RAM is not the win. */
export const LISTING_CACHE_MAX_ENTRIES = 20_000

export type ListingCacheDriveHint = {
  path: string
  driveType?: DriveTypeKind
}

/** Stable key: case-folded Windows/UNC, normalized `mfe-remote://`. */
export function listingCachePathKey(path: string): string {
  const trimmed = typeof path === 'string' ? path.trim() : ''
  if (!trimmed) return ''
  if (isRemoteLocation(trimmed)) {
    const loc = parseRemoteLocation(trimmed)
    if (!loc) return trimmed.toLowerCase()
    return formatRemoteLocation(loc.connectionId, loc.remotePath).toLowerCase()
  }
  const unc = parseUnc(trimmed)
  if (unc) return unc.unc.toLowerCase()
  const n = trimmed.replace(/\//g, '\\').replace(/\\+$/, '')
  if (/^[a-zA-Z]:$/i.test(n)) return `${n.toLowerCase()}\\`
  return n.toLowerCase()
}

export function driveTypeForPath(
  path: string,
  drives: ReadonlyArray<ListingCacheDriveHint>
): DriveTypeKind | null {
  const m = /^([a-zA-Z]):/.exec(path.trim())
  if (!m) return null
  const letter = m[1]!.toUpperCase()
  const d = drives.find((x) => {
    const dm = /^([a-zA-Z]):/.exec(x.path.trim().replace(/\//g, '\\'))
    return dm?.[1]?.toUpperCase() === letter
  })
  return d?.driveType ?? null
}

/**
 * UNC, `mfe-remote://`, or a mapped drive letter (`driveType === 'remote'`).
 * Local NTFS / removable / unknown letters are never cached.
 */
export function isListingCacheEligible(
  path: string,
  opts?: { driveType?: DriveTypeKind | null }
): boolean {
  if (typeof path !== 'string' || !path.trim()) return false
  if (isRemoteLocation(path)) return true
  if (parseUnc(path)) return true
  return opts?.driveType === 'remote'
}

export function listingCachePathIsUnder(childKey: string, parentKey: string): boolean {
  if (!childKey || !parentKey || childKey === parentKey) return false
  if (childKey.startsWith('mfe-remote://')) {
    if (!parentKey.startsWith('mfe-remote://')) return false
    if (parentKey.endsWith('/')) return childKey.startsWith(parentKey)
    return childKey.startsWith(`${parentKey}/`)
  }
  const prefix = parentKey.endsWith('\\') ? parentKey : `${parentKey}\\`
  return childKey.startsWith(prefix)
}

/** Insertion-order LRU. `get` refreshes recency. Huge listings are not stored. */
export class ListingLru<T> {
  private readonly map = new Map<string, T[]>()

  constructor(
    readonly maxFolders = LISTING_CACHE_MAX_FOLDERS,
    readonly maxEntries = LISTING_CACHE_MAX_ENTRIES
  ) {}

  get size(): number {
    return this.map.size
  }

  get(path: string): T[] | undefined {
    const key = listingCachePathKey(path)
    if (!key) return undefined
    const hit = this.map.get(key)
    if (!hit) return undefined
    this.map.delete(key)
    this.map.set(key, hit)
    return hit.slice()
  }

  /** Returns false when skipped (too large). Also evicts an existing entry for that path. */
  set(path: string, entries: readonly T[]): boolean {
    const key = listingCachePathKey(path)
    if (!key) return false
    if (entries.length > this.maxEntries) {
      this.map.delete(key)
      return false
    }
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, entries.slice())
    while (this.map.size > this.maxFolders) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
    return true
  }

  delete(path: string): void {
    const key = listingCachePathKey(path)
    if (key) this.map.delete(key)
  }

  /** Drop this folder and any cached descendants. */
  invalidate(path: string): void {
    const key = listingCachePathKey(path)
    if (!key) return
    this.map.delete(key)
    for (const k of [...this.map.keys()]) {
      if (listingCachePathIsUnder(k, key)) this.map.delete(k)
    }
  }

  clear(): void {
    this.map.clear()
  }
}
