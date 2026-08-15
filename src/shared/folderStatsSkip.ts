/**
 * Folders Calculate Statistics must not enter or tag (permission / system junk).
 * Names are compared case-insensitively.
 */
const PROTECTED_DIR_NAMES = new Set([
  '$recycle.bin',
  'system volume information',
  '$winreagent'
])

export function isProtectedStatsDirName(name: string): boolean {
  return PROTECTED_DIR_NAMES.has(name.trim().toLowerCase())
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
