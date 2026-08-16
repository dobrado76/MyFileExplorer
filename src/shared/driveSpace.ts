import type { DriveInfo } from './schemas/fs'

/**
 * Volumes we can query for free space. Offline maps are skipped (a dead Z:
 * must not stall the list). Online mapped letters are included — same `statfs`
 * path Properties uses. Unknown types are skipped.
 */
export function driveSpaceIsSafe(d: Pick<DriveInfo, 'driveType' | 'offline'>): boolean {
  if (d.offline) return false
  const t = d.driveType
  if (t === 'unknown') return false
  return (
    t === 'fixed' ||
    t === 'removable' ||
    t === 'cdrom' ||
    t === 'ramdisk' ||
    t === 'remote' ||
    t === undefined
  )
}

export function formatBytesBinary(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let u = -1
  do {
    v /= 1024
    u++
  } while (v >= 1024 && u < units.length - 1)
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`
}

/** Whole-number free percent, 0–100. */
export function freePercent(freeBytes: number, totalBytes: number): number {
  if (!(totalBytes > 0)) return 0
  const free = Math.min(Math.max(0, freeBytes), totalBytes)
  return Math.round((100 * free) / totalBytes)
}

/** Explorer-style: `123 GB free of 456 GB (27%)`. */
export function formatFreeOfTotal(freeBytes: number, totalBytes: number): string {
  if (!(totalBytes > 0)) return ''
  const free = Math.min(Math.max(0, freeBytes), totalBytes)
  return `${formatBytesBinary(free)} free of ${formatBytesBinary(totalBytes)} (${freePercent(free, totalBytes)}%)`
}

export function driveHasSpace(d: Pick<DriveInfo, 'totalBytes' | 'freeBytes'>): boolean {
  return typeof d.totalBytes === 'number' && d.totalBytes > 0 && typeof d.freeBytes === 'number'
}

export function formatDriveSpaceLine(d: DriveInfo): string | null {
  const letter = /^([a-zA-Z]):/.exec(d.path)?.[1]?.toUpperCase()
  if (d.offline) {
    return letter ? `${letter}: Disconnected` : 'Disconnected'
  }
  if (!driveHasSpace(d)) return null
  const body = formatFreeOfTotal(d.freeBytes!, d.totalBytes!)
  return letter ? `${letter}: ${body}` : body
}

export function formatAllDrivesSpace(drives: readonly DriveInfo[]): string {
  return drives.map(formatDriveSpaceLine).filter((s): s is string => !!s).join('  ·  ')
}

export function driveLetterOfPath(path: string): string | null {
  const m = /^([a-zA-Z]):/.exec(path.trim())
  return m ? m[1]!.toUpperCase() : null
}

export function driveInfoForPath(
  path: string,
  drives: readonly DriveInfo[]
): DriveInfo | undefined {
  const letter = driveLetterOfPath(path)
  if (!letter) return undefined
  return drives.find((d) => driveLetterOfPath(d.path) === letter)
}

export function usedBytesOf(d: Pick<DriveInfo, 'totalBytes' | 'freeBytes'>): number {
  if (!driveHasSpace(d)) return 0
  return Math.max(0, d.totalBytes! - d.freeBytes!)
}

/** True when less than 10% remains (Explorer turns the bar red). */
export function driveSpaceIsLow(d: Pick<DriveInfo, 'totalBytes' | 'freeBytes'>): boolean {
  if (!driveHasSpace(d)) return false
  return d.freeBytes! / d.totalBytes! < 0.1
}
