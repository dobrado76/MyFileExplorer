import type { UndeleteCandidate } from '@shared/schemas/undelete'
import { AppError } from '@shared/result'
import {
  assessRecoverability,
  bestFileName,
  frnRecordIndex,
  parseFileRecord,
  type ParsedFileRecord
} from './mftParse'
import { encodeUndeleteToken } from './token'
import {
  closeHandle,
  getNtfsVolumeData,
  needsUsnElevation,
  openVolumeHandle,
  type NtfsVolumeData
} from './volume'
import { buildMftLayout, readMftRecords, type MftLayout } from './mftMap'

export type UndeleteScanResult = {
  volume: string
  items: UndeleteCandidate[]
  scannedRecords: number
  elevated: boolean
  /** Internal recover map kept only for in-process recover (elevated path re-parses). */
  records: Map<string, { recordIndex: number; sequence: number; parsed: ParsedFileRecord }>
}

export type ScanProgress = (done: number, total: number, found: number) => void

export type DirEntry = { name: string; parentFrn: bigint; inUse: boolean }

function letterOf(volume: string): string {
  return volume.replace(/:\\?$/, '').toUpperCase()
}

/**
 * Walk parent FRNs to a folder path (no trailing filename).
 * Uses live + deleted directory records. Missing links become `…`.
 * Optional `loadDir` fills gaps (recover path — on-demand MFT reads).
 */
export function resolveParentPath(
  parentFrn: bigint,
  dirs: Map<number, DirEntry>,
  letter: string,
  loadDir?: (idx: number) => DirEntry | undefined
): string | null {
  const parts: string[] = []
  let cur = parentFrn
  const seen = new Set<number>()
  for (let depth = 0; depth < 64; depth++) {
    const idx = frnRecordIndex(cur)
    // MFT 5 = root directory; 0–4 are metadata.
    if (idx <= 5) {
      parts.reverse()
      if (parts.length === 0) return `${letter}:\\`
      return `${letter}:\\${parts.join('\\')}`
    }
    if (seen.has(idx)) break
    seen.add(idx)
    let d = dirs.get(idx)
    if (!d && loadDir) {
      d = loadDir(idx)
      if (d) dirs.set(idx, d)
    }
    if (!d) break
    parts.push(d.name)
    cur = d.parentFrn
  }
  // Walk stopped before root — keep whatever folder names we resolved.
  if (parts.length === 0) return null
  parts.reverse()
  return `${letter}:\\…\\${parts.join('\\')}`
}

/** Safe single path segment for recover under a user-chosen destination. */
export function sanitizeRecoverSegment(raw: string): string {
  let cleaned = ''
  for (const ch of raw) {
    const code = ch.charCodeAt(0)
    if (code < 32 || '<>:"/\\|?*'.includes(ch)) cleaned += '_'
    else cleaned += ch
  }
  cleaned = cleaned.replace(/\.+$/g, '').trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return '_'
  // Windows reserved device names
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(cleaned)) return `_${cleaned}`
  return cleaned
}

/**
 * Turn a scan path hint (`D:\Photos\2024` or `D:\…\Orphan`) into relative folder
 * segments under the recover destination (no drive letter, no filename).
 */
export function pathHintToRelativeSegments(pathHint: string | null, letter: string): string[] {
  if (!pathHint) return []
  const prefix = `${letter.toUpperCase()}:\\`
  let rest = pathHint
  if (rest.toUpperCase().startsWith(prefix)) rest = rest.slice(prefix.length)
  else if (/^[A-Za-z]:\\/.test(rest)) rest = rest.slice(3)
  if (!rest || rest === '\\') return []
  const parts = rest.split(/\\+/).filter((p) => p.length > 0)
  return parts.map((p) => (p === '…' || p === '...' ? '_incomplete' : sanitizeRecoverSegment(p)))
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Same courtesy as D28 bulk ops — keep renderer IPC responsive during MFT walk. */
const SCAN_YIELD_MS = 12

type ScanOpts = {
  onProgress?: ScanProgress
  signal?: AbortSignal
  /** When true (default for in-app), yield the main thread between chunks. */
  cooperative?: boolean
}

function rememberDir(
  dirs: Map<number, DirEntry>,
  recordIndex: number,
  parsed: ParsedFileRecord
): void {
  if (!parsed.isDirectory) return
  const fn = bestFileName(parsed.fileNames)
  if (!fn) return
  const existing = dirs.get(recordIndex)
  // Prefer an in-use directory name when the same index was also seen deleted.
  if (existing?.inUse && !parsed.inUse) return
  dirs.set(recordIndex, {
    name: fn.name,
    parentFrn: fn.parentFrn,
    inUse: parsed.inUse
  })
}

function buildCandidates(
  letter: string,
  deleted: Array<{ recordIndex: number; sequence: number; parsed: ParsedFileRecord }>,
  dirs: Map<number, DirEntry>,
  scanned: number
): UndeleteScanResult {
  const items: UndeleteCandidate[] = []
  const records = new Map<
    string,
    { recordIndex: number; sequence: number; parsed: ParsedFileRecord }
  >()
  for (const d of deleted) {
    const fn = bestFileName(d.parsed.fileNames)
    if (!fn) continue
    const isDir = d.parsed.isDirectory
    const { status, size } = isDir
      ? { status: 'unrecoverable' as const, size: 0 }
      : assessRecoverability(d.parsed)
    // Drop empty junk FILE records with no $DATA; keep directories (listed, not recovered in v1).
    if (!isDir && status === 'unrecoverable' && size === 0 && !d.parsed.data) continue
    const token = encodeUndeleteToken(`${letter}:`, d.recordIndex, d.sequence)
    // Parent folder only — never duplicate the filename into Path.
    const pathHint = resolveParentPath(fn.parentFrn, dirs, letter)
    items.push({
      token,
      name: fn.name,
      pathHint,
      size,
      status,
      isDir,
      mtimeMs: d.parsed.mtimeMs
    })
    records.set(token, d)
  }

  return {
    volume: `${letter}:`,
    items,
    scannedRecords: scanned,
    elevated: false,
    records
  }
}

function ingestRecord(
  recordIndex: number,
  parsed: ParsedFileRecord,
  dirs: Map<number, DirEntry>,
  deleted: Array<{ recordIndex: number; sequence: number; parsed: ParsedFileRecord }>
): void {
  rememberDir(dirs, recordIndex, parsed)
  // Deleted files and folders both become list candidates (folders = path context; recover is files-only).
  if (!parsed.inUse && bestFileName(parsed.fileNames)) {
    deleted.push({ recordIndex, sequence: parsed.sequence, parsed })
  }
}

/**
 * Walk `$MFT` for deleted FILE records.
 * In-app path must use `cooperative: true` (default) so Electron stays responsive.
 * Elevated CLI may pass `cooperative: false` for a blocking pass.
 */
export async function scanDeletedOnHandle(
  handle: unknown,
  volume: string,
  opts?: ScanOpts
): Promise<UndeleteScanResult> {
  const letter = letterOf(volume)
  const cooperative = opts?.cooperative !== false
  const volRes = getNtfsVolumeData(handle)
  if (!volRes.data) {
    throw new AppError(
      'io',
      `Could not read NTFS volume data for ${letter}: (Windows error ${volRes.err})`,
      needsUsnElevation(volRes.err) ? 'Retry as administrator' : undefined
    )
  }
  const vol = volRes.data
  const layout = buildMftLayout(handle, vol)
  const recordSize = layout.vol.bytesPerFileRecord
  const totalRecords = layout.recordCount
  const dirs = new Map<number, DirEntry>()
  const deleted: Array<{
    recordIndex: number
    sequence: number
    parsed: ParsedFileRecord
  }> = []

  // ~256 KiB chunks keep each sync burst short enough that a yield restores UI.
  const chunkRecords = Math.max(1, Math.floor((256 * 1024) / recordSize))
  let walked = 0
  let lastYieldMs = 0
  let lastProgressMs = 0
  opts?.onProgress?.(0, totalRecords, 0)

  for (let start = 0; start < totalRecords; start += chunkRecords) {
    if (opts?.signal?.aborted) {
      throw new AppError('cancelled', 'Undelete scan cancelled')
    }
    const count = Math.min(chunkRecords, totalRecords - start)
    const buf = readMftRecords(handle, layout, start, count)
    if (!buf || buf.length < recordSize) break
    const recordsInBuf = Math.floor(buf.length / recordSize)
    for (let i = 0; i < recordsInBuf; i++) {
      const recordIndex = start + i
      const slice = buf.subarray(i * recordSize, (i + 1) * recordSize)
      const parsed = parseFileRecord(slice, vol.bytesPerSector)
      walked++
      if (!parsed) continue
      ingestRecord(recordIndex, parsed, dirs, deleted)
    }
    const done = Math.min(start + recordsInBuf, totalRecords)
    const now = Date.now()
    if (now - lastProgressMs >= 80 || done >= totalRecords) {
      lastProgressMs = now
      opts?.onProgress?.(done, totalRecords, deleted.length)
    }
    if (cooperative && now - lastYieldMs >= SCAN_YIELD_MS) {
      lastYieldMs = now
      await yieldEventLoop()
    }
    if (recordsInBuf < count) break
  }

  opts?.onProgress?.(totalRecords, totalRecords, deleted.length)
  return buildCandidates(letter, deleted, dirs, walked)
}

/** Blocking scan for elevated CLI helper (hidden process; no UI to starve). */
export function scanDeletedOnHandleSync(
  handle: unknown,
  volume: string
): UndeleteScanResult {
  const letter = letterOf(volume)
  const volRes = getNtfsVolumeData(handle)
  if (!volRes.data) {
    throw new AppError(
      'io',
      `Could not read NTFS volume data for ${letter}: (Windows error ${volRes.err})`,
      needsUsnElevation(volRes.err) ? 'Retry as administrator' : undefined
    )
  }
  const vol = volRes.data
  const layout = buildMftLayout(handle, vol)
  const recordSize = layout.vol.bytesPerFileRecord
  const totalRecords = layout.recordCount
  const dirs = new Map<number, DirEntry>()
  const deleted: Array<{
    recordIndex: number
    sequence: number
    parsed: ParsedFileRecord
  }> = []
  const chunkRecords = Math.max(1, Math.floor((1024 * 1024) / recordSize))
  let walked = 0
  for (let start = 0; start < totalRecords; start += chunkRecords) {
    const count = Math.min(chunkRecords, totalRecords - start)
    const buf = readMftRecords(handle, layout, start, count)
    if (!buf || buf.length < recordSize) break
    const recordsInBuf = Math.floor(buf.length / recordSize)
    for (let i = 0; i < recordsInBuf; i++) {
      const recordIndex = start + i
      const slice = buf.subarray(i * recordSize, (i + 1) * recordSize)
      const parsed = parseFileRecord(slice, vol.bytesPerSector)
      walked++
      if (!parsed) continue
      ingestRecord(recordIndex, parsed, dirs, deleted)
    }
    if (recordsInBuf < count) break
  }
  return buildCandidates(letter, deleted, dirs, walked)
}

export async function scanDeletedVolume(
  volume: string,
  opts?: ScanOpts
): Promise<{ result: UndeleteScanResult; needsElevation: boolean; err: number }> {
  const letter = letterOf(volume)
  const opened = openVolumeHandle(letter, false)
  if (!opened.handle) {
    return {
      result: {
        volume: `${letter}:`,
        items: [],
        scannedRecords: 0,
        elevated: false,
        records: new Map()
      },
      needsElevation: needsUsnElevation(opened.err),
      err: opened.err
    }
  }
  try {
    const result = await scanDeletedOnHandle(opened.handle, `${letter}:`, opts)
    return { result, needsElevation: false, err: 0 }
  } finally {
    closeHandle(opened.handle)
  }
}

export function readFileRecordAt(
  handle: unknown,
  layout: MftLayout,
  recordIndex: number
): ParsedFileRecord | null {
  const buf = readMftRecords(handle, layout, recordIndex, 1)
  if (!buf || buf.length < layout.vol.bytesPerFileRecord) return null
  return parseFileRecord(buf, layout.vol.bytesPerSector)
}

/** @deprecated prefer buildMftLayout + readFileRecordAt(layout) */
export function readFileRecordAtVol(
  handle: unknown,
  vol: NtfsVolumeData,
  recordIndex: number
): ParsedFileRecord | null {
  const layout = buildMftLayout(handle, vol)
  return readFileRecordAt(handle, layout, recordIndex)
}

export { letterOf, buildMftLayout }
export type { MftLayout }
