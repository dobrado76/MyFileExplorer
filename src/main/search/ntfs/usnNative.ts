/**
 * Minimal NTFS USN journal helpers (koffi) for volume index bootstrap + monitor.
 * Falls back to walk when volume isn't NTFS or privileges/API fail.
 */
import koffi from 'koffi'
import { Buffer } from 'node:buffer'
import { parseUsnRecords } from './usnRecords'
import { logMain } from '../../logging'

const GENERIC_READ = 0x80000000
const GENERIC_WRITE = 0x40000000
const FILE_SHARE_READ = 0x00000001
const FILE_SHARE_WRITE = 0x00000002
const OPEN_EXISTING = 3
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
const INVALID_HANDLE_VALUE = -1n

const FSCTL_ENUM_USN_DATA = 0x000900b3
const FSCTL_QUERY_USN_JOURNAL = 0x000900f4
const FSCTL_READ_USN_JOURNAL = 0x000900bb
const FSCTL_CREATE_USN_JOURNAL = 0x000900e7
const FSCTL_DELETE_USN_JOURNAL = 0x000900f8
const USN_DELETE_FLAG_DELETE = 0x00000001

export const WINERR_ACCESS_DENIED = 5
export const WINERR_INVALID_HANDLE = 6
/** ERROR_JOURNAL_DELETE_IN_PROGRESS */
export const WINERR_JOURNAL_DELETE_IN_PROGRESS = 1178
/** ERROR_JOURNAL_NOT_ACTIVE */
export const WINERR_JOURNAL_NOT_ACTIVE = 1179
/** ERROR_JOURNAL_ENTRY_DELETED */
export const WINERR_JOURNAL_ENTRY_DELETED = 1181
export const WINERR_PRIVILEGE_NOT_HELD = 1314
export const WINERR_INVALID_PARAMETER = 87
const FILE_SHARE_DELETE = 0x00000004

koffi.struct('MfeUsnJournalData', {
  UsnJournalID: 'uint64',
  FirstUsn: 'int64',
  NextUsn: 'int64',
  LowestValidUsn: 'int64',
  MaxUsn: 'int64',
  MaximumSize: 'uint64',
  AllocationDelta: 'uint64'
})

koffi.struct('MfeMftEnumData', {
  StartFileReferenceNumber: 'uint64',
  LowUsn: 'int64',
  HighUsn: 'int64'
})

koffi.struct('MfeReadUsnJournalData', {
  StartUsn: 'int64',
  ReasonMask: 'uint32',
  ReturnOnlyOnClose: 'uint32',
  Timeout: 'uint64',
  BytesToWaitFor: 'uint64',
  UsnJournalID: 'uint64'
})

let native: {
  CreateFileW: (
    name: string,
    access: number,
    share: number,
    sec: null,
    disp: number,
    flags: number,
    template: null
  ) => unknown
  CloseHandle: (h: unknown) => boolean
  DeviceIoControl: (
    h: unknown,
    code: number,
    inBuf: Buffer | null,
    inSize: number,
    outBuf: Buffer,
    outSize: number,
    bytesRet: Buffer,
    overlapped: null
  ) => boolean
  GetLastError: () => number
  SetLastError: (err: number) => void
} | null = null

function ensureNative(): typeof native {
  if (native) return native
  if (process.platform !== 'win32') return null
  const kernel32 = koffi.load('kernel32.dll')
  native = {
    // HANDLE is pointer-sized but not a real pointer — pass as int64 so DeviceIoControl
    // does not get a boxed koffi pointer that Windows rejects (ERROR_INVALID_HANDLE / 6).
    CreateFileW: kernel32.func(
      'int64 __stdcall CreateFileW(str16 lpFileName, uint32 dwDesiredAccess, uint32 dwShareMode, void *lpSecurityAttributes, uint32 dwCreationDisposition, uint32 dwFlagsAndAttributes, void *hTemplateFile)'
    ) as typeof native extends null ? never : NonNullable<typeof native>['CreateFileW'],
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(int64 hObject)') as (
      h: unknown
    ) => boolean,
    DeviceIoControl: kernel32.func(
      'bool __stdcall DeviceIoControl(int64 hDevice, uint32 dwIoControlCode, void *lpInBuffer, uint32 nInBufferSize, void *lpOutBuffer, uint32 nOutBufferSize, void *lpBytesReturned, void *lpOverlapped)'
    ) as typeof native extends null ? never : NonNullable<typeof native>['DeviceIoControl'],
    GetLastError: kernel32.func('uint32 __stdcall GetLastError()') as () => number,
    SetLastError: kernel32.func('void __stdcall SetLastError(uint32 dwErrCode)') as (err: number) => void
  }
  return native
}

function handleInvalid(h: unknown): boolean {
  if (h == null) return true
  if (typeof h === 'bigint') return h === INVALID_HANDLE_VALUE || h === 0n
  if (typeof h === 'number') return h === -1 || h === 0
  return false
}

export type UsnJournalInfo = {
  journalId: bigint
  nextUsn: bigint
  firstUsn: bigint
  lowestValidUsn: bigint
  maxUsn: bigint
  maximumSize: bigint
  allocationDelta: bigint
}

export type UsnEntry = {
  frn: bigint
  parentFrn: bigint
  name: string
  isDir: boolean
  reason: number
  usn: bigint
  timeMs: number | null
}

function volumeDevicePath(volumeLetter: string): string {
  const letter = volumeLetter.replace(/:\\?$/, '').toUpperCase()
  return `\\\\.\\${letter}:`
}

export function openVolumeHandle(
  volumeLetter: string,
  write = false
): { handle: unknown | null; err: number } {
  const api = ensureNative()
  if (!api) return { handle: null, err: 1 }
  const letter = volumeLetter.replace(/:\\?$/, '').toUpperCase()
  const access = write ? GENERIC_READ | GENERIC_WRITE : GENERIC_READ
  const share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
  const attempts: Array<{ path: string; flags: number }> = [
    { path: volumeDevicePath(letter), flags: 0 },
    { path: volumeDevicePath(letter), flags: FILE_FLAG_BACKUP_SEMANTICS },
    { path: `${letter}:\\`, flags: FILE_FLAG_BACKUP_SEMANTICS }
  ]
  let lastErr = WINERR_ACCESS_DENIED
  for (const attempt of attempts) {
    api.SetLastError(0)
    const h = api.CreateFileW(attempt.path, access, share, null, OPEN_EXISTING, attempt.flags, null)
    const err = api.GetLastError()
    if (!handleInvalid(h)) return { handle: h, err: 0 }
    lastErr = err || lastErr
  }
  logMain('warn', `USN: CreateFile failed for ${letter}: (err=${lastErr})`)
  return { handle: null, err: lastErr }
}

export function lastWinError(): number {
  return ensureNative()?.GetLastError() ?? 0
}

export function needsUsnElevation(err: number): boolean {
  return (
    err === WINERR_ACCESS_DENIED ||
    err === WINERR_PRIVILEGE_NOT_HELD ||
    err === WINERR_INVALID_HANDLE ||
    err === 5 ||
    err === 6 ||
    err === 1314
  )
}

export function closeHandle(h: unknown): void {
  const api = ensureNative()
  if (!api || handleInvalid(h)) return
  try {
    api.CloseHandle(h)
  } catch {
    /* ignore */
  }
}

export function queryUsnJournalEx(h: unknown): { info: UsnJournalInfo | null; err: number } {
  const api = ensureNative()
  if (!api) return { info: null, err: 1 }
  const out = Buffer.alloc(64)
  const ret = Buffer.alloc(8)
  api.SetLastError(0)
  const ok = api.DeviceIoControl(h, FSCTL_QUERY_USN_JOURNAL, null, 0, out, out.length, ret, null)
  const err = api.GetLastError()
  if (!ok) {
    if (err !== WINERR_JOURNAL_NOT_ACTIVE && err !== WINERR_JOURNAL_DELETE_IN_PROGRESS) {
      logMain('warn', `USN: QUERY_USN_JOURNAL failed (err=${err})`)
    }
    return { info: null, err: err || WINERR_JOURNAL_NOT_ACTIVE }
  }
  return {
    info: {
      journalId: out.readBigUInt64LE(0),
      firstUsn: out.readBigInt64LE(8),
      nextUsn: out.readBigInt64LE(16),
      lowestValidUsn: out.readBigInt64LE(24),
      maxUsn: out.readBigInt64LE(32),
      maximumSize: out.readBigUInt64LE(40),
      allocationDelta: out.readBigUInt64LE(48)
    },
    err: 0
  }
}

export function queryUsnJournal(h: unknown): UsnJournalInfo | null {
  return queryUsnJournalEx(h).info
}

export function createUsnJournal(
  h: unknown,
  maxBytes: bigint,
  deltaBytes: bigint
): { ok: boolean; err: number } {
  const api = ensureNative()
  if (!api) return { ok: false, err: 1 }
  const inBuf = Buffer.alloc(16)
  inBuf.writeBigUInt64LE(maxBytes, 0)
  inBuf.writeBigUInt64LE(deltaBytes, 8)
  const out = Buffer.alloc(8)
  const ret = Buffer.alloc(8)
  api.SetLastError(0)
  const ok = api.DeviceIoControl(
    h,
    FSCTL_CREATE_USN_JOURNAL,
    inBuf,
    inBuf.length,
    out,
    out.length,
    ret,
    null
  )
  const err = api.GetLastError()
  if (!ok) logMain('warn', `USN: CREATE_USN_JOURNAL failed (err=${err})`)
  return { ok, err }
}

export function deleteUsnJournal(h: unknown, journalId: bigint): { ok: boolean; err: number } {
  const api = ensureNative()
  if (!api) return { ok: false, err: 1 }
  const inBuf = Buffer.alloc(16)
  inBuf.writeBigUInt64LE(journalId, 0)
  inBuf.writeUInt32LE(USN_DELETE_FLAG_DELETE, 8)
  const out = Buffer.alloc(8)
  const ret = Buffer.alloc(8)
  api.SetLastError(0)
  const ok = api.DeviceIoControl(
    h,
    FSCTL_DELETE_USN_JOURNAL,
    inBuf,
    inBuf.length,
    out,
    out.length,
    ret,
    null
  )
  const err = api.GetLastError()
  if (!ok) logMain('warn', `USN: DELETE_USN_JOURNAL failed (err=${err})`)
  return { ok, err }
}

/**
 * Enumerate MFT via FSCTL_ENUM_USN_DATA. Yields batches of USN records.
 * Caller builds FRN→path map.
 */
export function* enumUsnData(h: unknown): Generator<UsnEntry[]> {
  const api = ensureNative()
  if (!api) return
  let startFrn = 0n
  const outBuf = Buffer.alloc(1024 * 256)
  const retBuf = Buffer.alloc(8)
  for (;;) {
    const inBuf = Buffer.alloc(24)
    inBuf.writeBigUInt64LE(startFrn, 0)
    inBuf.writeBigInt64LE(0n, 8)
    inBuf.writeBigInt64LE(0x7fffffffffffffffn, 16)
    const ok = api.DeviceIoControl(
      h,
      FSCTL_ENUM_USN_DATA,
      inBuf,
      inBuf.length,
      outBuf,
      outBuf.length,
      retBuf,
      null
    )
    const bytes = Number(retBuf.readUInt32LE(0))
    if (!ok && bytes < 8) break
    if (bytes < 8) break
    startFrn = outBuf.readBigUInt64LE(0)
    const records = parseUsnRecords(outBuf, 8, bytes)
    if (records.length) yield records
    if (!ok) break // ERROR_HANDLE_EOF etc.
  }
}

function buildReadUsnInput(startUsn: bigint, journalId: bigint, v1: boolean): Buffer {
  const inBuf = Buffer.alloc(v1 ? 44 : 40)
  inBuf.writeBigInt64LE(startUsn, 0)
  inBuf.writeUInt32LE(0xffffffff, 8)
  inBuf.writeUInt32LE(0, 12)
  inBuf.writeBigUInt64LE(0n, 16)
  inBuf.writeBigUInt64LE(0n, 24)
  inBuf.writeBigUInt64LE(journalId, 32)
  if (v1) {
    inBuf.writeUInt16LE(2, 40)
    inBuf.writeUInt16LE(4, 42)
  }
  return inBuf
}

export function readUsnJournal(
  h: unknown,
  journalId: bigint,
  startUsn: bigint
): { nextUsn: bigint; entries: UsnEntry[]; err: number } | null {
  const api = ensureNative()
  if (!api) return null
  const outBuf = Buffer.alloc(1024 * 128)
  const retBuf = Buffer.alloc(8)
  const tryRead = (v1: boolean): { ok: boolean; bytes: number; err: number } => {
    const inBuf = buildReadUsnInput(startUsn, journalId, v1)
    api.SetLastError(0)
    const ok = api.DeviceIoControl(
      h,
      FSCTL_READ_USN_JOURNAL,
      inBuf,
      inBuf.length,
      outBuf,
      outBuf.length,
      retBuf,
      null
    )
    return { ok, bytes: Number(retBuf.readUInt32LE(0)), err: api.GetLastError() }
  }
  // Windows 8.1+ typically wants READ_USN_JOURNAL_DATA_V1 (44 bytes).
  let result = tryRead(true)
  if (!result.ok && (result.err === WINERR_INVALID_PARAMETER || result.err === 0)) {
    result = tryRead(false)
  }
  if (!result.ok || result.bytes < 8) {
    if (result.err && result.err !== WINERR_JOURNAL_ENTRY_DELETED) {
      logMain('warn', `USN: READ_USN_JOURNAL failed (err=${result.err}, bytes=${result.bytes})`)
    }
    return { nextUsn: startUsn, entries: [], err: result.err || 1 }
  }
  const nextUsn = outBuf.readBigInt64LE(0)
  const entries = parseUsnRecords(outBuf, 8, result.bytes)
  return { nextUsn, entries, err: 0 }
}

/** Build absolute paths from FRN parent links. Root FRN maps to volume root. */
export function buildPathMap(
  volumeRoot: string, // e.g. D:\
  records: Iterable<UsnEntry>
): Map<string, { path: string; isDir: boolean }> {
  const nodes = new Map<bigint, { parent: bigint; name: string; isDir: boolean }>()
  for (const r of records) {
    nodes.set(r.frn, { parent: r.parentFrn, name: r.name, isDir: r.isDir })
  }
  const cache = new Map<bigint, string | null>()
  const resolve = (frn: bigint, depth = 0): string | null => {
    if (depth > 64) return null
    if (cache.has(frn)) return cache.get(frn)!
    const node = nodes.get(frn)
    if (!node) {
      cache.set(frn, null)
      return null
    }
    // Parent missing → treat as volume root child
    if (!nodes.has(node.parent) || node.parent === frn) {
      const p = volumeRoot.replace(/[\\/]+$/, '') + '\\' + node.name
      cache.set(frn, p)
      return p
    }
    const parentPath = resolve(node.parent, depth + 1)
    if (!parentPath) {
      const p = volumeRoot.replace(/[\\/]+$/, '') + '\\' + node.name
      cache.set(frn, p)
      return p
    }
    const p = parentPath + '\\' + node.name
    cache.set(frn, p)
    return p
  }

  const out = new Map<string, { path: string; isDir: boolean }>()
  for (const [frn, node] of nodes) {
    const p = resolve(frn)
    if (!p) continue
    out.set(frn.toString(), { path: p, isDir: node.isDir })
  }
  return out
}

export function volumeLetterFromRoot(rootPath: string): string | null {
  const m = /^([a-zA-Z]):/i.exec(rootPath)
  return m ? `${m[1]!.toUpperCase()}:` : null
}
