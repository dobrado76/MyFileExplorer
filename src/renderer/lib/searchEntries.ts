import type { DirEntry } from '@shared/schemas/fs'
import type { SearchResultItem } from '@shared/schemas/search'

/** Map search hits into DirEntry so FileView can treat them like a normal listing. */
export function searchResultsToEntries(items: SearchResultItem[]): DirEntry[] {
  return items.map((item) => {
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
}
