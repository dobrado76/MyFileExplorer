import type {
  CompareEntrySnapshot,
  PairCompareOptions,
  PairCompareRow,
  PairCompareStatus
} from './types'
import { normalizeRelativePath, relativeDepth } from './pathUtils'

function kindsComparable(a: CompareEntrySnapshot, b: CompareEntrySnapshot): boolean {
  const dirLike = (k: string): boolean => k === 'directory' || k === 'junction'
  if (dirLike(a.kind) && dirLike(b.kind)) return true
  if (a.kind === 'file' && b.kind === 'file') return true
  if (a.kind === 'symlink' && b.kind === 'symlink') return true
  return a.kind === b.kind
}

function withinTolerance(a: number | null, b: number | null, tol: number): boolean {
  if (a == null || b == null) return a === b
  return Math.abs(a - b) <= tol
}

/**
 * Classify a paired left/right snapshot under the chosen comparison method.
 * Pure — no IO. Hash fields must already be filled when method requires them.
 */
export function classifyPair(
  left: CompareEntrySnapshot | null,
  right: CompareEntrySnapshot | null,
  options: Pick<PairCompareOptions, 'compareMethod' | 'modifiedToleranceMs'>
): { status: PairCompareStatus; reason: string } {
  if (!left && !right) {
    return { status: 'error', reason: 'Empty pair' }
  }
  if (left && !right) return { status: 'left_only', reason: 'Only on left' }
  if (!left && right) return { status: 'right_only', reason: 'Only on right' }

  const L = left!
  const R = right!

  if (!kindsComparable(L, R)) {
    return {
      status: 'type_conflict',
      reason: `Type conflict (${L.kind} vs ${R.kind})`
    }
  }

  const dirLike =
    L.kind === 'directory' ||
    L.kind === 'junction' ||
    R.kind === 'directory' ||
    R.kind === 'junction'
  if (dirLike) {
    return { status: 'identical', reason: 'Folder present on both sides' }
  }

  const tol = options.modifiedToleranceMs
  const sizeEqual = L.size != null && R.size != null && L.size === R.size
  const timeEqual = withinTolerance(L.modifiedMs, R.modifiedMs, tol)

  if (options.compareMethod === 'size') {
    if (sizeEqual) return { status: 'identical', reason: 'Same size' }
    return { status: 'different', reason: 'Different size' }
  }

  if (options.compareMethod === 'size_mtime') {
    if (sizeEqual && timeEqual) {
      return {
        status: 'identical',
        reason: 'Same size; modified times within tolerance'
      }
    }
    if (sizeEqual && !timeEqual && L.modifiedMs != null && R.modifiedMs != null) {
      if (L.modifiedMs > R.modifiedMs + tol) {
        return { status: 'left_newer', reason: 'Left modified more recently' }
      }
      if (R.modifiedMs > L.modifiedMs + tol) {
        return { status: 'right_newer', reason: 'Right modified more recently' }
      }
    }
    if (!sizeEqual && L.modifiedMs != null && R.modifiedMs != null && !timeEqual) {
      if (L.modifiedMs > R.modifiedMs + tol) {
        return { status: 'left_newer', reason: 'Left newer (size differs)' }
      }
      if (R.modifiedMs > L.modifiedMs + tol) {
        return { status: 'right_newer', reason: 'Right newer (size differs)' }
      }
    }
    return { status: 'different', reason: 'Size or time differs' }
  }

  // Hash methods
  if (L.hash && R.hash) {
    if (L.hash === R.hash) {
      if (timeEqual) return { status: 'identical', reason: 'Same content hash' }
      return {
        status: 'metadata_only',
        reason: 'Same content hash; timestamps differ'
      }
    }
    if (L.modifiedMs != null && R.modifiedMs != null && !timeEqual) {
      if (L.modifiedMs > R.modifiedMs + tol) {
        return { status: 'left_newer', reason: 'Content differs; left newer' }
      }
      if (R.modifiedMs > L.modifiedMs + tol) {
        return { status: 'right_newer', reason: 'Content differs; right newer' }
      }
    }
    return { status: 'different', reason: 'Content hashes differ' }
  }

  // Fallback when hashes not yet available
  if (sizeEqual && timeEqual) {
    return { status: 'identical', reason: 'Same size; modified times within tolerance' }
  }
  if (L.modifiedMs != null && R.modifiedMs != null && !timeEqual) {
    if (L.modifiedMs > R.modifiedMs + tol) {
      return { status: 'left_newer', reason: 'Left modified more recently' }
    }
    if (R.modifiedMs > L.modifiedMs + tol) {
      return { status: 'right_newer', reason: 'Right modified more recently' }
    }
  }
  return { status: 'different', reason: 'Could not confirm equality' }
}

export function makeRowId(relativePath: string, caseSensitive: boolean): string {
  return normalizeRelativePath(relativePath, caseSensitive) || '__root__'
}

export function buildRow(
  relativePath: string,
  left: CompareEntrySnapshot | null,
  right: CompareEntrySnapshot | null,
  options: Pick<PairCompareOptions, 'compareMethod' | 'modifiedToleranceMs' | 'caseSensitive'>
): PairCompareRow {
  const caseSensitive = options.caseSensitive === true
  const { status, reason } = classifyPair(left, right, options)
  return {
    id: makeRowId(relativePath, caseSensitive),
    relativePath,
    depth: relativeDepth(relativePath),
    left,
    right,
    status,
    reason
  }
}
