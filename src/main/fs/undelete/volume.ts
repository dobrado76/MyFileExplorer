/**
 * Raw NTFS volume access for undelete (koffi).
 */
import koffi from 'koffi'
import { Buffer } from 'node:buffer'
import { logMain } from '../../logging'
import {
  closeHandle,
  needsUsnElevation,
  openVolumeHandle,
  WINERR_ACCESS_DENIED
} from '../../search/ntfs/usnNative'

const FSCTL_GET_NTFS_VOLUME_DATA = 0x00090064

export { closeHandle, needsUsnElevation, openVolumeHandle }

let ioApi: {
  ReadFile: (
    h: unknown,
    buf: Buffer,
    toRead: number,
    bytesRead: Buffer,
    overlapped: null
  ) => boolean
  SetFilePointerEx: (
    h: unknown,
    dist: bigint,
    newPos: Buffer | null,
    method: number
  ) => boolean
  GetLastError: () => number
  SetLastError: (err: number) => void
} | null = null

const FILE_BEGIN = 0

function ensureIo(): typeof ioApi {
  if (ioApi) return ioApi
  if (process.platform !== 'win32') return null
  const kernel32 = koffi.load('kernel32.dll')
  ioApi = {
    ReadFile: kernel32.func(
      'bool __stdcall ReadFile(int64 hFile, void *lpBuffer, uint32 nNumberOfBytesToRead, void *lpNumberOfBytesRead, void *lpOverlapped)'
    ) as typeof ioApi extends null ? never : NonNullable<typeof ioApi>['ReadFile'],
    SetFilePointerEx: kernel32.func(
      'bool __stdcall SetFilePointerEx(int64 hFile, int64 liDistanceToMove, void *lpNewFilePointer, uint32 dwMoveMethod)'
    ) as typeof ioApi extends null ? never : NonNullable<typeof ioApi>['SetFilePointerEx'],
    GetLastError: kernel32.func('uint32 __stdcall GetLastError()') as () => number,
    SetLastError: kernel32.func('void __stdcall SetLastError(uint32 dwErrCode)') as (
      err: number
    ) => void
  }
  return ioApi
}

export type NtfsVolumeData = {
  bytesPerSector: number
  bytesPerCluster: number
  bytesPerFileRecord: number
  mftStartLcn: bigint
  mftValidDataLength: bigint
  totalClusters: bigint
}

export function getNtfsVolumeData(handle: unknown): { data: NtfsVolumeData | null; err: number } {
  // DeviceIoControl lives on usnNative's CreateFile stack — reuse via open + ioctl here.
  // Load DeviceIoControl locally to avoid exporting it from usnNative.
  if (process.platform !== 'win32') return { data: null, err: 1 }
  const kernel32 = koffi.load('kernel32.dll')
  const DeviceIoControl = kernel32.func(
    'bool __stdcall DeviceIoControl(int64 hDevice, uint32 dwIoControlCode, void *lpInBuffer, uint32 nInBufferSize, void *lpOutBuffer, uint32 nOutBufferSize, void *lpBytesReturned, void *lpOverlapped)'
  ) as (
    h: unknown,
    code: number,
    inBuf: Buffer | null,
    inSize: number,
    outBuf: Buffer,
    outSize: number,
    bytesRet: Buffer,
    overlapped: null
  ) => boolean
  const GetLastError = kernel32.func('uint32 __stdcall GetLastError()') as () => number
  const SetLastError = kernel32.func('void __stdcall SetLastError(uint32 dwErrCode)') as (
    err: number
  ) => void

  const out = Buffer.alloc(128)
  const ret = Buffer.alloc(8)
  SetLastError(0)
  const ok = DeviceIoControl(handle, FSCTL_GET_NTFS_VOLUME_DATA, null, 0, out, out.length, ret, null)
  const err = GetLastError()
  if (!ok) {
    logMain('warn', `Undelete: GET_NTFS_VOLUME_DATA failed (err=${err})`)
    return { data: null, err: err || WINERR_ACCESS_DENIED }
  }
  // NTFS_VOLUME_DATA_BUFFER layout (x64):
  // 0: VolumeSerialNumber (8)
  // 8: NumberSectors (8)
  // 16: TotalClusters (8)
  // 24: FreeClusters (8)
  // 32: TotalReserved (8)
  // 40: BytesPerSector (4)
  // 44: BytesPerCluster (4)
  // 48: BytesPerFileRecordSegment (4)
  // 52: ClustersPerFileRecordSegment (4)
  // 56: MftValidDataLength (8)
  // 64: MftStartLcn (8)
  const bytesPerSector = out.readUInt32LE(40)
  const bytesPerCluster = out.readUInt32LE(44)
  let bytesPerFileRecord = out.readUInt32LE(48)
  // When ClustersPerFileRecordSegment is negative (e.g. -10), size is 2^(-n) bytes.
  const clustersPerRecord = out.readInt32LE(52)
  if (clustersPerRecord < 0) {
    bytesPerFileRecord = 1 << -clustersPerRecord
  } else if (bytesPerFileRecord === 0 && clustersPerRecord > 0) {
    bytesPerFileRecord = clustersPerRecord * bytesPerCluster
  }
  if (bytesPerSector === 0 || bytesPerCluster === 0 || bytesPerFileRecord === 0) {
    return { data: null, err: 87 }
  }
  return {
    data: {
      bytesPerSector,
      bytesPerCluster,
      bytesPerFileRecord,
      mftStartLcn: out.readBigUInt64LE(64),
      mftValidDataLength: out.readBigUInt64LE(56),
      totalClusters: out.readBigUInt64LE(16)
    },
    err: 0
  }
}

export function seekVolume(handle: unknown, offset: bigint): boolean {
  const api = ensureIo()
  if (!api) return false
  api.SetLastError(0)
  return api.SetFilePointerEx(handle, offset, null, FILE_BEGIN)
}

/**
 * Raw `\\.\X:` reads must be sector-aligned (offset + length).
 * Returns the aligned read window and where the caller's bytes start inside it.
 */
export function alignedReadRange(
  offset: bigint,
  length: number,
  bytesPerSector: number
): { readOffset: bigint; readLength: number; sliceStart: number } {
  const sector = Math.max(1, bytesPerSector | 0)
  const s = BigInt(sector)
  const readOffset = offset - (offset % s)
  const end = offset + BigInt(length)
  const rem = end % s
  const readEnd = rem === 0n ? end : end + (s - rem)
  const readLength = Number(readEnd - readOffset)
  const sliceStart = Number(offset - readOffset)
  return { readOffset, readLength, sliceStart }
}

/**
 * Read `length` bytes at `offset` from a volume handle.
 * Aligns to `bytesPerSector` (default 512) — required for raw volume handles.
 */
export function readVolume(
  handle: unknown,
  offset: bigint,
  length: number,
  bytesPerSector = 512
): Buffer | null {
  const api = ensureIo()
  if (!api || length <= 0) return null
  const { readOffset, readLength, sliceStart } = alignedReadRange(offset, length, bytesPerSector)
  if (!Number.isFinite(readLength) || readLength <= 0 || readLength > 64 * 1024 * 1024) {
    return null
  }
  if (!seekVolume(handle, readOffset)) return null
  const buf = Buffer.alloc(readLength)
  const bytesRead = Buffer.alloc(8)
  api.SetLastError(0)
  const ok = api.ReadFile(handle, buf, readLength, bytesRead, null)
  if (!ok) return null
  const n = bytesRead.readUInt32LE(0)
  if (n <= sliceStart) return null
  const available = Math.min(length, n - sliceStart)
  if (available <= 0) return null
  return buf.subarray(sliceStart, sliceStart + available)
}

export function clusterOffset(vol: NtfsVolumeData, lcn: number | bigint): bigint {
  return BigInt(lcn) * BigInt(vol.bytesPerCluster)
}
