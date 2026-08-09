/**
 * Minimal NTFS USN journal helpers (koffi) for volume index bootstrap + monitor.
 * Falls back to walk when volume isn't NTFS or privileges/API fail.
 */
import koffi from 'koffi'
import { Buffer } from 'node:buffer'
import { logMain } from '../../logging'

const GENERIC_READ = 0x80000000
const FILE_SHARE_READ = 0x00000001
const FILE_SHARE_WRITE = 0x00000002
const OPEN_EXISTING = 3
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
const INVALID_HANDLE_VALUE = -1n

const FSCTL_ENUM_USN_DATA = 0x000900b3
const FSCTL_QUERY_USN_JOURNAL = 0x000900f4
const FSCTL_READ_USN_JOURNAL = 0x000900bb

const FILE_ATTRIBUTE_DIRECTORY = 0x10

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
} | null = null

function ensureNative(): typeof native {
  if (native) return native
  if (process.platform !== 'win32') return null
  const kernel32 = koffi.load('kernel32.dll')
  native = {
    CreateFileW: kernel32.func(
      'void * __stdcall CreateFileW(str16 lpFileName, uint32 dwDesiredAccess, uint32 dwShareMode, void *lpSecurityAttributes, uint32 dwCreationDisposition, uint32 dwFlagsAndAttributes, void *hTemplateFile)'
    ) as typeof native extends null ? never : NonNullable<typeof native>['CreateFileW'],
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *hObject)') as (
      h: unknown
    ) => boolean,
    DeviceIoControl: kernel32.func(
      'bool __stdcall DeviceIoControl(void *hDevice, uint32 dwIoControlCode, void *lpInBuffer, uint32 nInBufferSize, void *lpOutBuffer, uint32 nOutBufferSize, void *lpBytesReturned, void *lpOverlapped)'
    ) as typeof native extends null ? never : NonNullable<typeof native>['DeviceIoControl'],
    GetLastError: kernel32.func('uint32 __stdcall GetLastError()') as () => number
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
}

export type UsnEntry = {
  frn: bigint
  parentFrn: bigint
  name: string
  isDir: boolean
  reason: number
  usn: bigint
}

function volumeDevicePath(volumeLetter: string): string {
  const letter = volumeLetter.replace(/:\\?$/, '').toUpperCase()
  return `\\\\.\\${letter}:`
}

export function openVolumeHandle(volumeLetter: string): unknown | null {
  const api = ensureNative()
  if (!api) return null
  const h = api.CreateFileW(
    volumeDevicePath(volumeLetter),
    GENERIC_READ,
    FILE_SHARE_READ | FILE_SHARE_WRITE,
    null,
    OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS,
    null
  )
  if (handleInvalid(h)) {
    logMain('warn', `USN: CreateFile failed for ${volumeLetter} (err=${api.GetLastError()})`)
    return null
  }
  return h
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

export function queryUsnJournal(h: unknown): UsnJournalInfo | null {
  const api = ensureNative()
  if (!api) return null
  const out = Buffer.alloc(64)
  const ret = Buffer.alloc(8)
  const ok = api.DeviceIoControl(h, FSCTL_QUERY_USN_JOURNAL, null, 0, out, out.length, ret, null)
  if (!ok) return null
  return {
    journalId: out.readBigUInt64LE(0),
    firstUsn: out.readBigInt64LE(8),
    nextUsn: out.readBigInt64LE(16)
  }
}

function parseUsnRecords(buf: Buffer, start: number, end: number): UsnEntry[] {
  const out: UsnEntry[] = []
  let offset = start
  while (offset + 60 <= end) {
    const recordLength = buf.readUInt32LE(offset)
    if (recordLength < 60 || offset + recordLength > end) break
    const major = buf.readUInt16LE(offset + 4)
    if (major !== 2 && major !== 3) {
      offset += recordLength
      continue
    }
    const frn = buf.readBigUInt64LE(offset + 8)
    const parentFrn = buf.readBigUInt64LE(offset + 16)
    const usn = buf.readBigInt64LE(offset + 24)
    const reason = buf.readUInt32LE(offset + 40)
    const attrs = buf.readUInt32LE(offset + 52)
    const nameLen = buf.readUInt16LE(offset + 56)
    const nameOff = buf.readUInt16LE(offset + 58)
    const nameStart = offset + nameOff
    const name = buf.toString('utf16le', nameStart, nameStart + nameLen)
    out.push({
      frn,
      parentFrn,
      name,
      isDir: (attrs & FILE_ATTRIBUTE_DIRECTORY) !== 0,
      reason,
      usn
    })
    offset += recordLength
  }
  return out
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

export function readUsnJournal(
  h: unknown,
  journalId: bigint,
  startUsn: bigint
): { nextUsn: bigint; entries: UsnEntry[] } | null {
  const api = ensureNative()
  if (!api) return null
  const inBuf = Buffer.alloc(40)
  inBuf.writeBigInt64LE(startUsn, 0)
  inBuf.writeUInt32LE(0xffffffff, 8) // all reasons
  inBuf.writeUInt32LE(0, 12)
  inBuf.writeBigUInt64LE(0n, 16)
  inBuf.writeBigUInt64LE(0n, 24)
  inBuf.writeBigUInt64LE(journalId, 32)
  const outBuf = Buffer.alloc(1024 * 128)
  const retBuf = Buffer.alloc(8)
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
  const bytes = Number(retBuf.readUInt32LE(0))
  if (!ok || bytes < 8) return { nextUsn: startUsn, entries: [] }
  const nextUsn = outBuf.readBigInt64LE(0)
  const entries = parseUsnRecords(outBuf, 8, bytes)
  return { nextUsn, entries }
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
