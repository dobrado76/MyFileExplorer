import type { DirEntry } from '@shared/schemas/fs'
import type { RecycleBinItem } from '@shared/schemas/recycle'

/**
 * Map recycle-bin rows into DirEntry so FileView can treat them like a listing.
 * Dedupes by originalPath (keep newest dateDeleted) — Shell/NAS bins sometimes
 * emit duplicate rows, which break React keys and look like “ghost” lines.
 */
export function recycleBinItemsToEntries(items: RecycleBinItem[]): DirEntry[] {
  const byPath = new Map<string, RecycleBinItem>()
  for (const item of items) {
    const k = item.originalPath.toLowerCase()
    const prev = byPath.get(k)
    if (!prev || item.dateDeletedMs >= prev.dateDeletedMs) byPath.set(k, item)
  }
  return [...byPath.values()].map((item) => {
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
