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
