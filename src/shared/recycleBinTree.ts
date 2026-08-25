import { z } from 'zod'

/** Synthetic tree path for the Recycle Bin row (not a filesystem path). */
export const RECYCLE_BIN_TREE_PATH = 'mfe-special://recycle-bin'

export function isRecycleBinTreePath(path: string | null | undefined): boolean {
  return typeof path === 'string' && path === RECYCLE_BIN_TREE_PATH
}

/**
 * Where Recycle Bin chrome appears (Settings → Appearance).
 * Default `both` = tree row + tab-bar icon (Explorer-ish).
 */
export const RECYCLE_BIN_PLACEMENTS = ['none', 'tree', 'toolbar', 'both'] as const
export type RecycleBinPlacement = (typeof RECYCLE_BIN_PLACEMENTS)[number]

export const recycleBinPlacementSchema = z.enum(RECYCLE_BIN_PLACEMENTS)

export function recycleBinShowsInTree(placement: RecycleBinPlacement | null | undefined): boolean {
  return placement === 'tree' || placement === 'both'
}

export function recycleBinShowsInToolbar(placement: RecycleBinPlacement | null | undefined): boolean {
  return placement === 'toolbar' || placement === 'both'
}

/** Map legacy `showRecycleBinInTree` boolean (tree on → both; tree off → toolbar only). */
export function migrateRecycleBinPlacement(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const o = raw as Record<string, unknown>
  if (o.recycleBinPlacement != null) return raw
  if (typeof o.showRecycleBinInTree === 'boolean') {
    return {
      ...o,
      recycleBinPlacement: o.showRecycleBinInTree ? 'both' : 'toolbar'
    }
  }
  return raw
}
