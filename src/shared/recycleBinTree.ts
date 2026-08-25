/** Synthetic tree path for the Recycle Bin row (not a filesystem path). */
export const RECYCLE_BIN_TREE_PATH = 'mfe-special://recycle-bin'

export function isRecycleBinTreePath(path: string | null | undefined): boolean {
  return typeof path === 'string' && path === RECYCLE_BIN_TREE_PATH
}
