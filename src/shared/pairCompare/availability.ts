import { isRecycleBinTreePath } from '../recycleBinTree'
import { isRemoteLocation } from '../remotePaths'
import { isVirtualFolderDocumentPath } from '../virtualFolder'
import { isPathUnder } from './pathUtils'
import type { PairActionAvailability, PairRootKind } from './types'

export type PairPaneSnapshot = {
  hasTab: boolean
  path: string | null
  /** Search overlay active with results (or incomplete walk). */
  searchActive: boolean
  recycleActive: boolean
}

function classifyRoot(path: string | null): PairRootKind {
  if (!path) return 'unsupported'
  if (isRecycleBinTreePath(path)) return 'unsupported'
  if (isRemoteLocation(path)) return 'remote'
  if (isVirtualFolderDocumentPath(path)) return 'virtual_folder'
  // Projected VF mounts look like ordinary folders — treated as local for v1.
  if (/^\\\\[^\\/]+\\/.test(path) || path.startsWith('//')) return 'unc'
  if (/^[a-zA-Z]:[\\/]/.test(path) || /^[a-zA-Z]:$/i.test(path.replace(/[\\/]+$/, ''))) {
    return 'local'
  }
  if (path.startsWith('mfe-') || path.startsWith('mfe:')) return 'unsupported'
  // POSIX absolute (Linux contrib) or other absolute paths
  if (path.startsWith('/')) return 'local'
  return 'unsupported'
}

function syncAllowed(kind: PairRootKind): boolean {
  return kind === 'local' || kind === 'unc' || kind === 'projected_vf'
}

function compareAllowed(kind: PairRootKind): boolean {
  return syncAllowed(kind) || kind === 'virtual_folder'
}

/**
 * Pure enablement for the centre action rail (layout 2 only).
 */
export function computePairActionAvailability(input: {
  viewLayout: number
  left: PairPaneSnapshot
  right: PairPaneSnapshot
}): PairActionAvailability {
  const railVisible = input.viewLayout === 2
  const leftPath = input.left.path
  const rightPath = input.right.path
  const leftKind = classifyRoot(leftPath)
  const rightKind = classifyRoot(rightPath)

  const base: PairActionAvailability = {
    railVisible,
    canCompare: false,
    canCopyLeftToRight: false,
    canCopyRightToLeft: false,
    canSync: false,
    canSwap: false,
    sameRoot: false,
    nestedRoots: false,
    disableReason: null,
    leftRoot: leftPath,
    rightRoot: rightPath,
    leftKind,
    rightKind
  }

  if (!railVisible) {
    return { ...base, disableReason: 'Available only in side-by-side (2-pane) layout' }
  }

  if (!input.left.hasTab || !input.right.hasTab || !leftPath || !rightPath) {
    return {
      ...base,
      canSwap: input.left.hasTab && input.right.hasTab,
      disableReason: 'Both panes need an active folder tab'
    }
  }

  base.canSwap = true

  if (input.left.recycleActive || input.right.recycleActive) {
    return { ...base, disableReason: 'Recycle Bin cannot be paired' }
  }
  if (input.left.searchActive || input.right.searchActive) {
    return { ...base, disableReason: 'Exit search results before pairing folders' }
  }

  if (!compareAllowed(leftKind) || !compareAllowed(rightKind)) {
    return {
      ...base,
      disableReason: 'One or both locations are not supported for pairing'
    }
  }

  if (leftKind === 'remote' || rightKind === 'remote') {
    return {
      ...base,
      canCopyLeftToRight: leftKind !== 'remote' && rightKind !== 'unsupported',
      canCopyRightToLeft: rightKind !== 'remote' && leftKind !== 'unsupported',
      disableReason: 'Remote repositories: sync deferred; limited copy may work'
    }
  }

  if (leftKind === 'virtual_folder' || rightKind === 'virtual_folder') {
    return {
      ...base,
      disableReason: 'App-internal Virtual Folders without OS projection are deferred'
    }
  }

  const same =
    leftPath.replace(/[/\\]+$/, '').toLowerCase() ===
    rightPath.replace(/[/\\]+$/, '').toLowerCase()
  if (same) {
    return {
      ...base,
      sameRoot: true,
      canCompare: true,
      disableReason: 'Both panes point to the same folder'
    }
  }

  const nested =
    isPathUnder(leftPath, rightPath, false) || isPathUnder(rightPath, leftPath, false)
  if (nested) {
    return {
      ...base,
      nestedRoots: true,
      disableReason: 'Nested roots are blocked (would copy a tree into itself)'
    }
  }

  const canSync = syncAllowed(leftKind) && syncAllowed(rightKind)
  return {
    ...base,
    canCompare: true,
    canCopyLeftToRight: true,
    canCopyRightToLeft: true,
    canSync,
    disableReason: null
  }
}
