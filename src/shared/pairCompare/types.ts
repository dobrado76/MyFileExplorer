import type { PairCompareMethod } from '../schemas/pairFolders'

export type PairCompareStatus =
  | 'identical'
  | 'left_only'
  | 'right_only'
  | 'left_newer'
  | 'right_newer'
  | 'different'
  | 'type_conflict'
  | 'metadata_only'
  | 'inaccessible'
  | 'error'

export type CompareEntryKind = 'file' | 'directory' | 'symlink' | 'junction' | 'other'

export type CompareEntrySnapshot = {
  absolutePath: string
  relativePath: string
  kind: CompareEntryKind
  size: number | null
  modifiedMs: number | null
  createdMs?: number | null
  fileId?: string | null
  volumeId?: string | null
  hash?: string | null
  attributes?: number | null
}

export type PairCompareRow = {
  id: string
  relativePath: string
  depth: number
  left: CompareEntrySnapshot | null
  right: CompareEntrySnapshot | null
  status: PairCompareStatus
  reason: string
  aggregate?: {
    identical: number
    different: number
    leftOnly: number
    rightOnly: number
    conflicts: number
    errors: number
  }
}

export type PairCompareOptions = {
  includeSubfolders: boolean
  followLinks: boolean
  includeHidden: boolean
  compareMethod: PairCompareMethod
  modifiedToleranceMs: number
  ignoreEmptyFolders: boolean
  caseSensitive: boolean | 'auto'
}

export type PairCompareCounts = Record<PairCompareStatus, number>

export type PairComparisonResult = {
  sessionId: string
  leftRoot: string
  rightRoot: string
  options: PairCompareOptions
  createdAt: number
  rows: PairCompareRow[]
  counts: PairCompareCounts
  incomplete: boolean
  scanErrors: { relativePath: string; message: string }[]
}

export type PairSyncDirection = 'left_to_right' | 'right_to_left' | 'two_way'

export type PairSyncPolicy = 'update' | 'mirror' | 'missing_only'

export type PairSyncScope = 'visible' | 'selected' | 'entire'

export type PairSyncAction =
  | 'copy'
  | 'replace'
  | 'create_folder'
  | 'trash'
  | 'delete_permanent'
  | 'skip'
  | 'conflict'

export type PairSyncPlanEntry = {
  id: string
  action: PairSyncAction
  relativePath: string
  sourcePath: string | null
  destinationPath: string | null
  reason: string
  bytes: number
  decision?: 'use_left' | 'use_right' | 'keep_both' | 'keep_recent' | 'skip' | null
  requiredDecision: boolean
  rowId: string
}

export type PairSyncPlan = {
  planId: string
  sessionId: string
  direction: PairSyncDirection
  policy: PairSyncPolicy
  scope: PairSyncScope
  leftRoot: string
  rightRoot: string
  createdAt: number
  incompleteSource: boolean
  entries: PairSyncPlanEntry[]
  summary: {
    copy: number
    replace: number
    createFolder: number
    remove: number
    conflicts: number
    excluded: number
    bytes: number
  }
}

export type PairPlanValidation = {
  planId: string
  ok: boolean
  staleEntryIds: string[]
  missingSourceIds: string[]
  typeChangedIds: string[]
}

export type PairRootKind = 'local' | 'unc' | 'projected_vf' | 'virtual_folder' | 'remote' | 'unsupported'

export type PairActionAvailability = {
  railVisible: boolean
  canCompare: boolean
  canCopyLeftToRight: boolean
  canCopyRightToLeft: boolean
  canSync: boolean
  canSwap: boolean
  sameRoot: boolean
  nestedRoots: boolean
  disableReason: string | null
  leftRoot: string | null
  rightRoot: string | null
  leftKind: PairRootKind
  rightKind: PairRootKind
}
