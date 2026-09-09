import fsp from 'node:fs/promises'
import type {
  CompareEntryKind,
  CompareEntrySnapshot,
  PairSyncPlan,
  PairPlanValidation
} from '@shared/pairCompare/types'

type LiveSnapshot = {
  exists: boolean
  size: number | null
  modifiedMs: number | null
  kind: CompareEntryKind | null
}

async function statSnap(abs: string | null): Promise<LiveSnapshot> {
  if (!abs) return { exists: false, size: null, modifiedMs: null, kind: null }
  try {
    const st = await fsp.lstat(abs)
    const kind: CompareEntryKind = st.isFile()
      ? 'file'
      : st.isDirectory()
        ? 'directory'
        : st.isSymbolicLink()
          ? 'symlink'
          : 'other'
    return {
      exists: true,
      size: st.isFile() ? st.size : null,
      modifiedMs: st.mtimeMs,
      kind
    }
  } catch {
    return { exists: false, size: null, modifiedMs: null, kind: null }
  }
}

function matchesSnapshot(
  live: LiveSnapshot,
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

function kindMatches(live: LiveSnapshot, snap: CompareEntrySnapshot): boolean {
  if (!live.exists || !live.kind) return false
  if (snap.kind === 'junction') return live.kind === 'symlink'
  return live.kind === snap.kind
}

function snapshotAtPath(
  snapshots: { left: CompareEntrySnapshot | null; right: CompareEntrySnapshot | null } | undefined,
  absPath: string
): CompareEntrySnapshot | null {
  if (snapshots?.left?.absolutePath === absPath) return snapshots.left
  if (snapshots?.right?.absolutePath === absPath) return snapshots.right
  return null
}

/** Re-stat plan sources/destinations against comparison-time expectations. */
export async function revalidatePlan(
  plan: PairSyncPlan,
  rowSnapshots: Map<
    string,
    { left: CompareEntrySnapshot | null; right: CompareEntrySnapshot | null }
  >
): Promise<PairPlanValidation> {
  const staleEntryIds = new Set<string>()
  const missingSourceIds = new Set<string>()
  const typeChangedIds = new Set<string>()

  for (const e of plan.entries) {
    if (e.action === 'skip') continue
    const snaps = rowSnapshots.get(e.rowId)

    // An unresolved conflict can copy in either direction. Validate both captured
    // sides so the UI preflight cannot report a changed conflict row as safe.
    if (e.action === 'conflict') {
      for (const snap of [snaps?.left, snaps?.right]) {
        if (!snap) continue
        const live = await statSnap(snap.absolutePath)
        if (!live.exists || !matchesSnapshot(live, snap, true)) {
          staleEntryIds.add(e.id)
        } else if (!kindMatches(live, snap)) {
          typeChangedIds.add(e.id)
        }
      }
      continue
    }

    if (e.sourcePath) {
      const live = await statSnap(e.sourcePath)
      if (!live.exists) {
        missingSourceIds.add(e.id)
        continue
      }
      const srcSnap = snapshotAtPath(snaps, e.sourcePath)
      if (srcSnap && !matchesSnapshot(live, srcSnap, true)) {
        staleEntryIds.add(e.id)
      } else if (srcSnap && !kindMatches(live, srcSnap)) {
        typeChangedIds.add(e.id)
      }
    }

    if (e.destinationPath) {
      const live = await statSnap(e.destinationPath)
      const dstSnap = snapshotAtPath(snaps, e.destinationPath)
      if (!matchesSnapshot(live, dstSnap, Boolean(dstSnap))) {
        staleEntryIds.add(e.id)
      } else if (dstSnap && live.exists && !kindMatches(live, dstSnap)) {
        typeChangedIds.add(e.id)
      }
    }
  }

  const stale = [...staleEntryIds]
  const missing = [...missingSourceIds]
  const typeChanged = [...typeChangedIds]
  return {
    planId: plan.planId,
    ok: stale.length === 0 && missing.length === 0 && typeChanged.length === 0,
    staleEntryIds: stale,
    missingSourceIds: missing,
    typeChangedIds: typeChanged
  }
}
