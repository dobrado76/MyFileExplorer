import { pathKey } from './paths'

export type RemovalMatcher = {
  /** True if `path` is exactly removed or lives under a removed directory. */
  matches(path: string): boolean
}

/**
 * Fast bulk-delete matcher. Flat file deletes stay O(1) Set lookups; only known
 * (or unknown) directory roots pay a short prefix scan.
 *
 * Pass `directoryKeys` from the listing when known. Omit it only when every
 * removed path must be treated as a possible folder (safer, slower).
 */
export function createRemovalMatcher(
  removed: readonly string[],
  opts?: { directoryKeys?: ReadonlySet<string> }
): RemovalMatcher {
  const exact = new Set(removed.map((p) => pathKey(p)))
  const dirKeys =
    opts?.directoryKeys != null ? [...opts.directoryKeys] : [...exact]
  return {
    matches(path: string): boolean {
      const k = pathKey(path)
      if (exact.has(k)) return true
      for (const d of dirKeys) {
        if (k === d || k.startsWith(`${d}\\`)) return true
      }
      return false
    }
  }
}

/** Classify which removed paths are directories (from listing kinds). */
export function removalDirectoryKeys(
  removed: readonly string[],
  knownKinds: ReadonlyMap<string, 'dir' | 'file'>
): Set<string> {
  const dirs = new Set<string>()
  for (const p of removed) {
    const k = pathKey(p)
    const kind = knownKinds.get(k)
    // Not in the listing (tree / deep path): treat as a folder so descendants prune.
    if (kind === 'dir' || kind === undefined) dirs.add(k)
  }
  return dirs
}
