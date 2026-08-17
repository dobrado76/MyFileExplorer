import { samePath } from './paths'

/**
 * Focused path if it is in the selection; otherwise the last selected path.
 * With no file selection, preview the current folder (tree / listing).
 */
export function resolvePreviewTargetPath(
  selected: readonly string[],
  focusedPath: string | null | undefined,
  folderPath?: string | null
): string | null {
  if (selected.length === 0) {
    const folder = folderPath?.trim()
    return folder || null
  }
  if (focusedPath && selected.some((p) => samePath(p, focusedPath))) return focusedPath
  return selected[selected.length - 1] ?? null
}
