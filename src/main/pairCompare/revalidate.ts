import fsp from 'node:fs/promises'
import type { CompareEntrySnapshot, PairSyncPlan, PairPlanValidation } from '@shared/pairCompare/types'

async function statSnap(
  abs: string | null
): Promise<{ exists: boolean; size: number | null; modifiedMs: number | null; isDir: boolean }> {
  if (!abs) return { exists: false, size: null, modifiedMs: null, isDir: false }
  try {
    const st = await fsp.lstat(abs)
    return {
      exists: true,
      size: st.isFile() ? st.size : null,
      modifiedMs: st.mtimeMs,
      isDir: st.isDirectory()
    }
  } catch {
    return { exists: false, size: null, modifiedMs: null, isDir: false }
  }
}

function matchesSnapshot(
  live: { exists: boolean; size: number | null; modifiedMs: number | null },
  snap: CompareEntrySnapshot | null | undefined,
  expectExists: boolean
): boolean {
  if (!expectExists) return !live.exists
  if (!snap) return !live.exists
  if (!live.exists) return false
  if (snap.size != null && live.size != null && snap.size !== live.size) return false
  if (
    snap.modifiedMs != null &&
    live.modifiedMs != null &&
    Math.abs(snap.modifiedMs - live.modifiedMs) > 2
  ) {
    return false
  }
  return true
}

/** Re-stat plan sources/destinations against comparison-time expectations. */
export async function revalidatePlan(
  plan: PairSyncPlan,
  rowSnapshots: Map<
    string,
    { left: CompareEntrySnapshot | null; right: CompareEntrySnapshot | null }
  >
): Promise<PairPlanValidation> {
  const staleEntryIds: string[] = []
  const missingSourceIds: string[] = []
  const typeChangedIds: string[] = []

  for (const e of plan.entries) {
    if (e.action === 'skip' || e.action === 'conflict') continue
    const snaps = rowSnapshots.get(e.rowId)

    if (e.sourcePath) {
      const live = await statSnap(e.sourcePath)
      if (!live.exists) {
        missingSourceIds.push(e.id)
        continue
      }
      const srcSnap =
        snaps?.left?.absolutePath === e.sourcePath
          ? snaps.left
          : snaps?.right?.absolutePath === e.sourcePath
            ? snaps.right
            : null
      if (srcSnap && !matchesSnapshot(live, srcSnap, true)) {
        staleEntryIds.push(e.id)
      }
    }

    if (
      (e.action === 'replace' || e.action === 'trash' || e.action === 'delete_permanent') &&
      e.destinationPath
    ) {
      const live = await statSnap(e.destinationPath)
      const dstSnap =
        snaps?.left?.absolutePath === e.destinationPath
          ? snaps.left
          : snaps?.right?.absolutePath === e.destinationPath
            ? snaps.right
            : null
      if (!live.exists && (e.action === 'trash' || e.action === 'delete_permanent')) {
        staleEntryIds.push(e.id)
      } else if (dstSnap && live.exists && !matchesSnapshot(live, dstSnap, true)) {
        staleEntryIds.push(e.id)
      } else if (dstSnap && live.exists && dstSnap.kind === 'file' && live.isDir) {
        typeChangedIds.push(e.id)
      }
    }
  }

  return {
    planId: plan.planId,
    ok:
      staleEntryIds.length === 0 &&
      missingSourceIds.length === 0 &&
      typeChangedIds.length === 0,
    staleEntryIds,
    missingSourceIds,
    typeChangedIds
  }
}
