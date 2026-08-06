import type { DirEntry } from '@shared/schemas/fs'
import type { RecycleBinItem } from '@shared/schemas/recycle'

/** Map recycle-bin rows into DirEntry so FileView can treat them like a listing. */
export function recycleBinItemsToEntries(items: RecycleBinItem[]): DirEntry[] {
  return items.map((item) => {
    const dot = item.name.lastIndexOf('.')
    const ext =
      !item.isDir && dot > 0 && dot < item.name.length - 1
        ? item.name.slice(dot + 1).toLowerCase()
        : ''
    return {
      name: item.name,
      path: item.originalPath,
      kind: item.isDir ? 'dir' : 'file',
      size: item.size,
      mtimeMs: item.dateDeletedMs,
      birthtimeMs: item.dateDeletedMs,
      ext,
      isHidden: false
    }
  })
}
