import { normalizeSlashes, pathKey, stripTrailingSep } from './paths'

/**
 * Folders Calculate Statistics must not enter or tag (permission / system junk).
 * Names are compared case-insensitively.
 */
const PROTECTED_DIR_NAMES = new Set([
  '$recycle.bin',
  'system volume information',
  '$winreagent'
])

/** Cap for Settings → Behavior skip list (user-skipped unwritable folders). */
export const MAX_FOLDER_STATS_SKIP_PATHS = 256

export function isProtectedStatsDirName(name: string): boolean {
  return PROTECTED_DIR_NAMES.has(name.trim().toLowerCase())
}

/** Deduped, slash-normalized absolute paths for `folderStatsSkipPaths`. */
export function normalizeFolderStatsSkipPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed) continue
    const key = pathKey(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(stripTrailingSep(normalizeSlashes(trimmed)))
    if (out.length >= MAX_FOLDER_STATS_SKIP_PATHS) break
  }
  return out
}

export function folderStatsSkipPathKeys(paths: readonly string[]): Set<string> {
  return new Set(paths.map((p) => pathKey(p)))
}

export function isSkippedStatsPath(absPath: string, skipKeys: ReadonlySet<string>): boolean {
  return skipKeys.has(pathKey(absPath))
}

export function addFolderStatsSkipPath(list: readonly string[], absPath: string): string[] {
  return normalizeFolderStatsSkipPaths([...list, absPath])
}

export function removeFolderStatsSkipPath(list: readonly string[], absPath: string): string[] {
  const key = pathKey(absPath)
  return list.filter((p) => pathKey(p) !== key)
}

/** Pure skip rule used by the stats walk (attrs + view filter supplied by caller). */
export function shouldSkipFolderForStats(opts: {
  name: string
  system: boolean
  hidden: boolean
  /** Settings → View filter is on (same as hiding Hidden items in the listing). */
  hideHidden: boolean
  filterMatch: boolean
}): boolean {
  if (isProtectedStatsDirName(opts.name)) return true
  if (opts.system) return true
  if (opts.hideHidden && opts.hidden) return true
  return opts.filterMatch
}
