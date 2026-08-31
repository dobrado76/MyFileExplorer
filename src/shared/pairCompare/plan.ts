import type {
  PairCompareRow,
  PairCompareStatus,
  PairSyncDirection,
  PairSyncPlan,
  PairSyncPlanEntry,
  PairSyncPolicy,
  PairSyncScope
} from './types'
import { joinUnderRoot, parentRelativePath } from './pathUtils'

const DIFF_STATUSES: Set<PairCompareStatus> = new Set([
  'left_only',
  'right_only',
  'left_newer',
  'right_newer',
  'different',
  'type_conflict',
  'inaccessible',
  'error'
])

function entryId(prefix: string, relativePath: string): string {
  return `${prefix}:${relativePath}`
}

function isFolderRow(row: PairCompareRow): boolean {
  const k = row.left?.kind ?? row.right?.kind
  return k === 'directory' || k === 'junction'
}

function suppressCoveredChildren(rows: PairCompareRow[], selected: Set<string>): Set<string> {
  const kept = new Set(selected)
  const folderRels = rows
    .filter((r) => kept.has(r.id) && isFolderRow(r))
    .map((r) => r.relativePath.replace(/\\/g, '/'))
  for (const row of rows) {
    if (!kept.has(row.id)) continue
    const rel = row.relativePath.replace(/\\/g, '/')
    for (const folder of folderRels) {
      if (rel === folder) continue
      if (rel.startsWith(folder + '/')) {
        kept.delete(row.id)
        break
      }
    }
  }
  return kept
}

function filterRows(
  rows: PairCompareRow[],
  scope: PairSyncScope,
  selectedRowIds: string[] | undefined,
  visibleStatuses: PairCompareStatus[] | undefined
): PairCompareRow[] {
  if (scope === 'entire') return rows
  if (scope === 'selected') {
    const set = new Set(selectedRowIds ?? [])
    const picked = rows.filter((r) => set.has(r.id))
    const kept = suppressCoveredChildren(picked, new Set(picked.map((r) => r.id)))
    return picked.filter((r) => kept.has(r.id))
  }
  // visible
  const statuses = new Set(visibleStatuses ?? [...DIFF_STATUSES])
  return rows.filter((r) => statuses.has(r.status))
}

function pushCopy(
  entries: PairSyncPlanEntry[],
  row: PairCompareRow,
  sourceSide: 'left' | 'right',
  leftRoot: string,
  rightRoot: string,
  action: 'copy' | 'replace',
  reason: string
): void {
  const src = sourceSide === 'left' ? row.left : row.right
  if (!src) return
  const destRoot = sourceSide === 'left' ? rightRoot : leftRoot
  const dest = joinUnderRoot(destRoot, row.relativePath)
  entries.push({
    id: entryId(action, row.relativePath),
    action,
    relativePath: row.relativePath,
    sourcePath: src.absolutePath,
    destinationPath: dest,
    reason,
    bytes: src.size ?? 0,
    requiredDecision: false,
    rowId: row.id
  })
}

function ensureParentCreates(
  entries: PairSyncPlanEntry[],
  relativePath: string,
  destRoot: string,
  existing: Set<string>
): void {
  let parent = parentRelativePath(relativePath)
  const stack: string[] = []
  while (parent) {
    stack.push(parent)
    parent = parentRelativePath(parent)
  }
  for (const p of stack.reverse()) {
    if (existing.has(p)) continue
    existing.add(p)
    entries.push({
      id: entryId('create_folder', p),
      action: 'create_folder',
      relativePath: p,
      sourcePath: null,
      destinationPath: joinUnderRoot(destRoot, p),
      reason: 'Create parent folder',
      bytes: 0,
      requiredDecision: false,
      rowId: p
    })
  }
}

/**
 * Build a reviewed sync plan from comparison rows. Never executes.
 * Two-way never deletes. Mirror deletes only when policy is mirror and source scan complete.
 */
export function buildSyncPlan(input: {
  sessionId: string
  planId: string
  direction: PairSyncDirection
  policy: PairSyncPolicy
  scope: PairSyncScope
  leftRoot: string
  rightRoot: string
  rows: PairCompareRow[]
  selectedRowIds?: string[]
  visibleStatuses?: PairCompareStatus[]
  incompleteSource: boolean
}): PairSyncPlan {
  const {
    sessionId,
    planId,
    direction,
    policy,
    scope,
    leftRoot,
    rightRoot,
    incompleteSource
  } = input

  if (policy === 'mirror' && incompleteSource) {
    return {
      planId,
      sessionId,
      direction,
      policy,
      scope,
      leftRoot,
      rightRoot,
      createdAt: Date.now(),
      incompleteSource: true,
      entries: [],
      summary: {
        copy: 0,
        replace: 0,
        createFolder: 0,
        remove: 0,
        conflicts: 0,
        excluded: 0,
        bytes: 0
      }
    }
  }

  const rows = filterRows(input.rows, scope, input.selectedRowIds, input.visibleStatuses)
  const entries: PairSyncPlanEntry[] = []
  const parentsCreated = new Set<string>()
  let excluded = 0

  const oneWay = (
    sourceSide: 'left' | 'right',
    destSide: 'left' | 'right'
  ): void => {
    const destRoot = destSide === 'left' ? leftRoot : rightRoot
    for (const row of rows) {
      const src = sourceSide === 'left' ? row.left : row.right
      const dst = destSide === 'left' ? row.left : row.right

      if (row.status === 'inaccessible' || row.status === 'error') {
        excluded++
        continue
      }
      if (row.status === 'type_conflict') {
        entries.push({
          id: entryId('conflict', row.relativePath),
          action: 'conflict',
          relativePath: row.relativePath,
          sourcePath: src?.absolutePath ?? null,
          destinationPath: dst?.absolutePath ?? null,
          reason: row.reason,
          bytes: 0,
          requiredDecision: true,
          rowId: row.id
        })
        continue
      }

      const onlyOnSource =
        (sourceSide === 'left' && row.status === 'left_only') ||
        (sourceSide === 'right' && row.status === 'right_only')
      const onlyOnDest =
        (destSide === 'left' && row.status === 'left_only') ||
        (destSide === 'right' && row.status === 'right_only')
      const sourceNewer =
        (sourceSide === 'left' && row.status === 'left_newer') ||
        (sourceSide === 'right' && row.status === 'right_newer')
      const destNewer =
        (destSide === 'left' && row.status === 'left_newer') ||
        (destSide === 'right' && row.status === 'right_newer')

      if (onlyOnDest) {
        if (policy === 'mirror' && dst) {
          entries.push({
            id: entryId('trash', row.relativePath),
            action: 'trash',
            relativePath: row.relativePath,
            sourcePath: null,
            destinationPath: dst.absolutePath,
            reason: 'Destination-only (mirror)',
            bytes: dst.size ?? 0,
            requiredDecision: false,
            rowId: row.id
          })
        }
        continue
      }

      if (onlyOnSource && src) {
        if (isFolderRow(row)) {
          ensureParentCreates(entries, row.relativePath, destRoot, parentsCreated)
          pushCopy(entries, row, sourceSide, leftRoot, rightRoot, 'copy', 'Missing on destination')
        } else {
          ensureParentCreates(entries, row.relativePath, destRoot, parentsCreated)
          pushCopy(entries, row, sourceSide, leftRoot, rightRoot, 'copy', 'Missing on destination')
        }
        continue
      }

      if (policy === 'missing_only') continue

      if (sourceNewer && src) {
        ensureParentCreates(entries, row.relativePath, destRoot, parentsCreated)
        pushCopy(entries, row, sourceSide, leftRoot, rightRoot, 'replace', 'Source newer')
        continue
      }

      if (destNewer || row.status === 'different') {
        entries.push({
          id: entryId('conflict', row.relativePath),
          action: 'conflict',
          relativePath: row.relativePath,
          sourcePath: src?.absolutePath ?? null,
          destinationPath: dst?.absolutePath ?? null,
          reason:
            destNewer
              ? 'Destination appears newer'
              : 'Both differ without a clear winner',
          bytes: 0,
          requiredDecision: true,
          rowId: row.id
        })
      }
    }
  }

  if (direction === 'left_to_right') oneWay('left', 'right')
  else if (direction === 'right_to_left') oneWay('right', 'left')
  else {
    // Two-way additive/update only — never delete
    for (const row of rows) {
      if (row.status === 'inaccessible' || row.status === 'error') {
        excluded++
        continue
      }
      if (row.status === 'type_conflict' || row.status === 'different') {
        entries.push({
          id: entryId('conflict', row.relativePath),
          action: 'conflict',
          relativePath: row.relativePath,
          sourcePath: row.left?.absolutePath ?? null,
          destinationPath: row.right?.absolutePath ?? null,
          reason: row.reason,
          bytes: 0,
          requiredDecision: true,
          rowId: row.id
        })
        continue
      }
      if (row.status === 'left_only' && row.left) {
        ensureParentCreates(entries, row.relativePath, rightRoot, parentsCreated)
        pushCopy(entries, row, 'left', leftRoot, rightRoot, 'copy', 'Left only → copy to right')
      } else if (row.status === 'right_only' && row.right) {
        ensureParentCreates(entries, row.relativePath, leftRoot, parentsCreated)
        pushCopy(entries, row, 'right', leftRoot, rightRoot, 'copy', 'Right only → copy to left')
      } else if (row.status === 'left_newer' && row.left) {
        ensureParentCreates(entries, row.relativePath, rightRoot, parentsCreated)
        pushCopy(entries, row, 'left', leftRoot, rightRoot, 'replace', 'Left newer')
      } else if (row.status === 'right_newer' && row.right) {
        ensureParentCreates(entries, row.relativePath, leftRoot, parentsCreated)
        pushCopy(entries, row, 'right', leftRoot, rightRoot, 'replace', 'Right newer')
      }
    }
  }

  const summary = {
    copy: entries.filter((e) => e.action === 'copy').length,
    replace: entries.filter((e) => e.action === 'replace').length,
    createFolder: entries.filter((e) => e.action === 'create_folder').length,
    remove: entries.filter((e) => e.action === 'trash' || e.action === 'delete_permanent').length,
    conflicts: entries.filter((e) => e.action === 'conflict').length,
    excluded,
    bytes: entries.reduce((n, e) => n + (e.bytes || 0), 0)
  }

  return {
    planId,
    sessionId,
    direction,
    policy,
    scope,
    leftRoot,
    rightRoot,
    createdAt: Date.now(),
    incompleteSource,
    entries,
    summary
  }
}
