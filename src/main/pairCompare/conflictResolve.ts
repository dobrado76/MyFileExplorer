import { AppError } from '@shared/result'
import { applyKeepNewer } from '@shared/opIssues'
import { joinUnderRoot } from '@shared/pairCompare/pathUtils'
import type { PairSyncPlan, PairSyncPlanEntry } from '@shared/pairCompare/types'
import type { ConflictPolicy } from '@shared/schemas/fs'

/** Planned keep-both direction: one-way uses plan direction; two-way defaults left→right. */
function plannedConflictPair(
  plan: PairSyncPlan,
  entry: PairSyncPlanEntry
): { source: string; dest: string } {
  const left = joinUnderRoot(plan.leftRoot, entry.relativePath)
  const right = joinUnderRoot(plan.rightRoot, entry.relativePath)
  if (plan.direction === 'right_to_left') return { source: right, dest: left }
  if (plan.direction === 'left_to_right') return { source: left, dest: right }
  if (entry.sourcePath && entry.destinationPath) {
    return { source: entry.sourcePath, dest: entry.destinationPath }
  }
  return { source: left, dest: right }
}

export type ResolvedConflictTransfer =
  | { kind: 'skip' }
  | {
      kind: 'copy'
      source: string
      dest: string
      policy: ConflictPolicy
      countAs: 'copied' | 'replaced'
    }

/**
 * Map a conflict decision to a concrete copy (or skip).
 * `leftMtimeMs` / `rightMtimeMs` are captured comparison values for `keep_recent`;
 * execution revalidates both paths before using the resolved transfer.
 */
export function resolveConflictTransfer(
  plan: PairSyncPlan,
  entry: PairSyncPlanEntry,
  decision: string,
  times?: { leftMtimeMs: number; rightMtimeMs: number }
): ResolvedConflictTransfer {
  const left = joinUnderRoot(plan.leftRoot, entry.relativePath)
  const right = joinUnderRoot(plan.rightRoot, entry.relativePath)

  if (decision === 'skip') return { kind: 'skip' }

  if (decision === 'use_left') {
    return { kind: 'copy', source: left, dest: right, policy: 'replace', countAs: 'replaced' }
  }
  if (decision === 'use_right') {
    return { kind: 'copy', source: right, dest: left, policy: 'replace', countAs: 'replaced' }
  }
  if (decision === 'keep_both') {
    const pair = plannedConflictPair(plan, entry)
    return {
      kind: 'copy',
      source: pair.source,
      dest: pair.dest,
      policy: 'rename',
      countAs: 'copied'
    }
  }
  if (decision === 'keep_recent') {
    if (!times) {
      throw new AppError('validation', 'keep_recent requires mtimes')
    }
    // Newer *side* wins (left vs right), not the baked plan direction.
    const verdict = applyKeepNewer(times.leftMtimeMs, times.rightMtimeMs)
    if (verdict === 'replace') {
      // left newer than right → left wins
      return { kind: 'copy', source: left, dest: right, policy: 'replace', countAs: 'replaced' }
    }
    if (verdict === 'skip') {
      // right newer → right wins
      return { kind: 'copy', source: right, dest: left, policy: 'replace', countAs: 'replaced' }
    }
    // equal → keep both via rename into planned destination
    const pair = plannedConflictPair(plan, entry)
    return {
      kind: 'copy',
      source: pair.source,
      dest: pair.dest,
      policy: 'rename',
      countAs: 'copied'
    }
  }
  throw new AppError('validation', `Unknown conflict decision: ${decision}`)
}
