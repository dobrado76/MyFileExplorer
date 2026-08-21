import type { DirEntry } from '@shared/schemas/fs'
import type { SearchResultItem } from '@shared/schemas/search'
import { dedupeDirEntries } from '@shared/dirEntries'
import { isUnderPath, samePath } from './paths'

/** Map search hits into DirEntry so FileView can treat them like a normal listing. */
export function searchResultsToEntries(items: SearchResultItem[]): DirEntry[] {
  return dedupeDirEntries(
    items.map((item) => {
      const dot = item.name.lastIndexOf('.')
      const ext =
        !item.isDir && dot > 0 && dot < item.name.length - 1
          ? item.name.slice(dot + 1).toLowerCase()
          : ''
      return {
        name: item.name,
        path: item.path,
        kind: item.isDir ? 'dir' : 'file',
        size: item.size,
        mtimeMs: item.mtimeMs,
        birthtimeMs: 0,
        ext,
        isHidden: item.isHidden === true
      }
    })
  )
}

/** Drop hits that were deleted/moved, including children of a removed folder. */
export function pruneSearchResultItems(
  items: SearchResultItem[],
  removed: string[]
): SearchResultItem[] {
  if (removed.length === 0 || items.length === 0) return items
  return items.filter(
    (item) => !removed.some((r) => samePath(item.path, r) || isUnderPath(item.path, r))
  )
}

/** Remember deleted/moved paths so a still-running scan cannot re-add them. */
export function mergeDismissedPaths(existing: string[], removed: string[]): string[] {
  if (removed.length === 0) return existing
  const next = [...existing]
  let added = false
  for (const r of removed) {
    if (next.some((p) => samePath(p, r) || isUnderPath(r, p))) continue
    next.push(r)
    added = true
  }
  return added ? next : existing
}
