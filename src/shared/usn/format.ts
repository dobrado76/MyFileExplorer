/** Default createjournal sizes (Windows fsutil example). */
export const DEFAULT_USN_JOURNAL_MAX_BYTES = 64 * 1024 * 1024
export const DEFAULT_USN_JOURNAL_DELTA_BYTES = 8 * 1024 * 1024

export const USN_JOURNAL_MAX_BYTES_MIN = 1024 * 1024
export const USN_JOURNAL_MAX_BYTES_MAX = 4 * 1024 * 1024 * 1024
export const USN_JOURNAL_DELTA_BYTES_MIN = 512 * 1024
export const USN_JOURNAL_DELTA_BYTES_MAX = 1024 * 1024 * 1024

const REASON_FLAGS: Array<[number, string]> = [
  [0x00000001, 'Data overwrite'],
  [0x00000002, 'Data extend'],
  [0x00000004, 'Data truncation'],
  [0x00000010, 'Named data overwrite'],
  [0x00000020, 'Named data extend'],
  [0x00000040, 'Named data truncation'],
  [0x00000100, 'Create'],
  [0x00000200, 'Delete'],
  [0x00000400, 'EA change'],
  [0x00000800, 'Security change'],
  [0x00001000, 'Rename (old)'],
  [0x00002000, 'Rename (new)'],
  [0x00004000, 'Indexable change'],
  [0x00008000, 'Basic info change'],
  [0x00010000, 'Hard link change'],
  [0x00020000, 'Compression change'],
  [0x00040000, 'Encryption change'],
  [0x00080000, 'Object ID change'],
  [0x00100000, 'Reparse point'],
  [0x00200000, 'Stream change'],
  [0x00400000, 'Transacted change'],
  [0x80000000, 'Close']
]

export function decodeUsnReasons(reason: number): string[] {
  if (!Number.isFinite(reason) || reason === 0) return []
  return REASON_FLAGS.filter(([bit]) => (reason & bit) !== 0).map(([, label]) => label)
}

export function formatUsnReasons(reason: number): string {
  const labels = decodeUsnReasons(reason)
  return labels.length ? labels.join(', ') : '—'
}

export function formatUsnId(value: string | number | bigint): string {
  try {
    const n = typeof value === 'bigint' ? value : BigInt(value)
    return n.toString()
  } catch {
    return String(value)
  }
}

export function usnJournalFillRatio(firstUsn: string, nextUsn: string, maximumSize: string): number {
  try {
    const span = BigInt(nextUsn) - BigInt(firstUsn)
    const max = BigInt(maximumSize)
    if (max <= 0n || span <= 0n) return 0
    const ratio = Number(span) / Number(max)
    if (!Number.isFinite(ratio)) return 0
    return Math.min(1, Math.max(0, ratio))
  } catch {
    return 0
  }
}

export function bytesToMib(bytes: number): number {
  return bytes / (1024 * 1024)
}

export function mibToBytes(mib: number): number {
  return Math.round(mib * 1024 * 1024)
}

export function clampUsnJournalSizes(
  maxBytes: number,
  deltaBytes: number
): { maxBytes: number; deltaBytes: number } {
  let max = Math.round(maxBytes)
  let delta = Math.round(deltaBytes)
  if (!Number.isFinite(max)) max = DEFAULT_USN_JOURNAL_MAX_BYTES
  if (!Number.isFinite(delta)) delta = DEFAULT_USN_JOURNAL_DELTA_BYTES
  max = Math.min(USN_JOURNAL_MAX_BYTES_MAX, Math.max(USN_JOURNAL_MAX_BYTES_MIN, max))
  delta = Math.min(USN_JOURNAL_DELTA_BYTES_MAX, Math.max(USN_JOURNAL_DELTA_BYTES_MIN, delta))
  if (delta > max) delta = max
  return { maxBytes: max, deltaBytes: delta }
}

/** Win32 FILETIME (100-ns since 1601) → unix ms, or null if unusable. */
export function fileTimeToUnixMs(fileTime: bigint): number | null {
  if (fileTime <= 0n) return null
  const unixMs = Number(fileTime / 10000n - 11644473600000n)
  if (!Number.isFinite(unixMs) || unixMs < 0) return null
  return unixMs
}

export function formatUsnTimestamp(unixMs: number | null): string {
  if (unixMs == null) return '—'
  try {
    return new Date(unixMs).toLocaleString()
  } catch {
    return '—'
  }
}

export function driveLetterLabel(path: string): string {
  const m = /^([a-zA-Z]):/.exec(path.trim())
  return m ? `${m[1]!.toUpperCase()}:` : path
}

/** Unique throwaway file written then deleted after first Enable so Recent shows Create + Delete. */
export const USN_PROBE_NAME_PREFIX = 'testing USN '

export function usnProbeFileName(token: string): string {
  const clean = token.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)
  return `${USN_PROBE_NAME_PREFIX}${clean || 'probe'}.txt`
}

export function isUsnProbeFileName(name: string): boolean {
  return name.startsWith(USN_PROBE_NAME_PREFIX) && /\.txt$/i.test(name)
}

export function sameVolumePrefix(volumeRoot: string, candidate: string): boolean {
  const root = volumeRoot.replace(/[\\/]+$/, '').toUpperCase()
  const cand = candidate.replace(/[\\/]+$/, '').toUpperCase()
  return cand === root || cand.startsWith(`${root}\\`) || cand.startsWith(`${root}/`)
}

/** Prefer the OS temp dir when it lives on the same volume (writable, less clutter on the root). */
export function resolveUsnProbeDir(volumeRoot: string, tmpDir: string): string {
  return sameVolumePrefix(volumeRoot, tmpDir) ? tmpDir : volumeRoot
}

export type ParsedFsutilUsnQuery = {
  journalId: bigint
  firstUsn: bigint
  nextUsn: bigint
  lowestValidUsn: bigint
  maxUsn: bigint
  maximumSize: bigint
  allocationDelta: bigint
}

export function isUsnJournalDeletingMessage(text: string): boolean {
  return /being deleted|delete in progress|\b1178\b/i.test(text)
}

export function isUsnJournalAbsentMessage(text: string): boolean {
  return /not active|does not exist|cannot find|\b1179\b/i.test(text)
}

/** Parse `fsutil usn queryjournal X:` stdout (English labels, hex or decimal). */
export function parseFsutilUsnQuery(stdout: string): ParsedFsutilUsnQuery | null {
  const grab = (label: string): bigint | null => {
    const re = new RegExp(`${label}\\s*:\\s*(0x[0-9a-fA-F]+|\\d+)`, 'i')
    const m = re.exec(stdout)
    if (!m) return null
    try {
      return BigInt(m[1]!)
    } catch {
      return null
    }
  }
  const journalId = grab('Usn Journal ID')
  const firstUsn = grab('First Usn')
  const nextUsn = grab('Next Usn')
  const lowestValidUsn = grab('Lowest Valid Usn')
  const maxUsn = grab('Max Usn')
  const maximumSize = grab('Maximum Size')
  const allocationDelta = grab('Allocation Delta')
  if (
    journalId == null ||
    firstUsn == null ||
    nextUsn == null ||
    lowestValidUsn == null ||
    maxUsn == null ||
    maximumSize == null ||
    allocationDelta == null
  ) {
    return null
  }
  return { journalId, firstUsn, nextUsn, lowestValidUsn, maxUsn, maximumSize, allocationDelta }
}

export type ParsedFsutilUsnRecord = {
  usn: string
  name: string
  isDir: boolean
  reason: number
  timeMs: number | null
}

const FILE_ATTRIBUTE_DIRECTORY = 0x10

function grabFsutilField(block: string, label: string): string | null {
  const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+?)\\s*$`, 'im')
  const m = re.exec(block)
  return m?.[1]?.trim() || null
}

function parseFsutilHex(raw: string | null): number {
  if (!raw) return 0
  const m = /0x([0-9a-f]+)/i.exec(raw)
  if (m) return Number.parseInt(m[1]!, 16)
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : 0
}

function parseFsutilUsnTime(raw: string | null): number | null {
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

/** Parse `fsutil usn readjournal` text records (oldest first). Returns newest-first, capped. */
export function parseFsutilUsnReadJournal(stdout: string, limit = 200): ParsedFsutilUsnRecord[] {
  const cap = Math.min(500, Math.max(1, limit))
  const blocks = stdout.split(/(?=^\s*Usn\s*:)/im)
  const out: ParsedFsutilUsnRecord[] = []
  for (const block of blocks) {
    const usnRaw = grabFsutilField(block, 'Usn')
    const name = grabFsutilField(block, 'File name')
    if (!usnRaw || !name) continue
    let usn: bigint
    try {
      usn = BigInt(usnRaw)
    } catch {
      continue
    }
    const attrs = parseFsutilHex(grabFsutilField(block, 'File attributes'))
    out.push({
      usn: usn.toString(),
      name,
      isDir: (attrs & FILE_ATTRIBUTE_DIRECTORY) !== 0,
      reason: parseFsutilHex(grabFsutilField(block, 'Reason')),
      timeMs: parseFsutilUsnTime(grabFsutilField(block, 'Time stamp'))
    })
  }
  if (out.length > cap) return out.slice(out.length - cap).reverse()
  return out.reverse()
}
