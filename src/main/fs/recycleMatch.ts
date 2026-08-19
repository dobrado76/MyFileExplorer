import path from 'node:path'

/**
 * Map a Recycle Bin item (DeletedFrom + Name) to a wanted original path, or null.
 *
 * DeletedFrom is normally the **parent** folder. Matching on DeletedFrom alone would
 * wrongly hit every file previously trashed from inside a folder when restoring
 * only that folder (undo of folder-delete must not revive earlier file-deletes).
 *
 * Fallback: some Shell hosts report DeletedFrom as the full original path already;
 * accept that only when basename(DeletedFrom) === Name.
 */
export function matchRecycleOriginal(
  deletedFrom: string,
  name: string,
  wantedLower: ReadonlySet<string>
): string | null {
  const loc = deletedFrom.replace(/[/\\]+$/g, '')
  const combined = path.win32.join(loc, name)
  if (wantedLower.has(combined.toLowerCase())) return combined
  if (
    wantedLower.has(loc.toLowerCase()) &&
    path.win32.basename(loc).toLowerCase() === name.toLowerCase()
  ) {
    return loc
  }
  return null
}

export type RecyclePickItem = {
  recyclePath: string
  originalPath: string
  dateDeletedMs: number
}

function pathKey(p: string): string {
  return p.replace(/[/\\]+$/g, '').toLowerCase()
}

/**
 * Resolve UI / undo keys to unique bin rows.
 *
 * - `$Recycle.Bin` / shell `recyclePath` → that row only (Explorer: two deletes of
 *   the same original path are two items).
 * - Original full path (Ctrl+Z after Del) → the **newest** dateDeleted only, so
 *   we do not restore every historical copy of that path.
 */
export function pickRecycleBinTargets(
  items: readonly RecyclePickItem[],
  wanted: readonly string[]
): RecyclePickItem[] {
  const byRecycle = new Map<string, RecyclePickItem>()
  const byOriginal = new Map<string, RecyclePickItem[]>()
  for (const it of items) {
    const rp = pathKey(it.recyclePath)
    const op = pathKey(it.originalPath)
    if (rp) byRecycle.set(rp, it)
    if (op) {
      const list = byOriginal.get(op) ?? []
      list.push(it)
      byOriginal.set(op, list)
    }
  }
  const picked: RecyclePickItem[] = []
  const used = new Set<string>()
  for (const raw of wanted) {
    const key = pathKey(raw)
    if (!key) continue
    const exact = byRecycle.get(key)
    if (exact) {
      const id = pathKey(exact.recyclePath)
      if (!used.has(id)) {
        used.add(id)
        picked.push(exact)
      }
      continue
    }
    const group = (byOriginal.get(key) ?? []).filter((g) => !used.has(pathKey(g.recyclePath)))
    if (group.length === 0) continue
    const newest = group.reduce((a, b) => (a.dateDeletedMs >= b.dateDeletedMs ? a : b))
    used.add(pathKey(newest.recyclePath))
    picked.push(newest)
  }
  return picked
}
