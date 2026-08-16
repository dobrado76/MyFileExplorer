import type { DriveInfo } from './schemas/fs'

/** Local volumes we can query without hanging on a dead network map. */
export function driveSpaceIsSafe(d: Pick<DriveInfo, 'driveType' | 'offline'>): boolean {
  if (d.offline) return false
  const t = d.driveType
  return t === 'fixed' || t === 'removable' || t === 'cdrom' || t === 'ramdisk' || t === undefined
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

/** Explorer-style: `123 GB free of 456 GB`. */
export function formatFreeOfTotal(freeBytes: number, totalBytes: number): string {
  if (!(totalBytes > 0)) return ''
  const free = Math.min(Math.max(0, freeBytes), totalBytes)
  return `${formatBytesBinary(free)} free of ${formatBytesBinary(totalBytes)}`
}

export function driveHasSpace(d: Pick<DriveInfo, 'totalBytes' | 'freeBytes'>): boolean {
  return typeof d.totalBytes === 'number' && d.totalBytes > 0 && typeof d.freeBytes === 'number'
}

export function formatDriveSpaceLine(d: DriveInfo): string | null {
  if (!driveHasSpace(d)) return null
  const letter = /^([a-zA-Z]):/.exec(d.path)?.[1]?.toUpperCase()
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
