import { samePath } from './paths'

/** Focused path if it is in the selection; otherwise the last selected path. */
export function resolvePreviewTargetPath(
  selected: readonly string[],
  focusedPath: string | null | undefined
): string | null {
  if (selected.length === 0) return null
  if (focusedPath && selected.some((p) => samePath(p, focusedPath))) return focusedPath
  return selected[selected.length - 1] ?? null
}
