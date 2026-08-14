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
        isHidden: false
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
