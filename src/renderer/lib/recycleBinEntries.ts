import type { DirEntry } from '@shared/schemas/fs'
import type { RecycleBinItem } from '@shared/schemas/recycle'

/**
 * Map recycle-bin rows into DirEntry so FileView can treat them like a listing.
 *
 * Identity is `recyclePath` (the `$R…` / shell item), not `originalPath`.
 * Windows keeps two deletes of the same source path as two bin items; Explorer
 * shows both (same name, different Date deleted). Deduping by originalPath hid
 * the older copy. True Shell duplicates (same recyclePath twice) still collapse.
 */
export function recycleBinItemsToEntries(items: RecycleBinItem[]): DirEntry[] {
  const byRecycle = new Map<string, RecycleBinItem>()
  for (const item of items) {
    const k = item.recyclePath.replace(/[/\\]+$/g, '').toLowerCase()
    if (!k) continue
    const prev = byRecycle.get(k)
    if (!prev || item.dateDeletedMs >= prev.dateDeletedMs) byRecycle.set(k, item)
  }
  return [...byRecycle.values()].map((item) => {
    const dot = item.name.lastIndexOf('.')
    const ext =
      !item.isDir && dot > 0 && dot < item.name.length - 1
        ? item.name.slice(dot + 1).toLowerCase()
        : ''
    return {
      name: item.name,
      path: item.recyclePath,
      kind: item.isDir ? 'dir' : 'file',
      size: item.size,
      mtimeMs: item.dateDeletedMs,
      birthtimeMs: item.dateDeletedMs,
      ext,
      isHidden: false
    }
  })
}
