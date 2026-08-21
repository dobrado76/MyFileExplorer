/**
 * NTFS Alternate Data Streams — Trinet.Core.IO.Ntfs / ADS.cs parity (koffi).
 * Soft-fails on non-win32 / access denied / non-NTFS.
 * Host times: FileBasicInfo restore (includes ChangeTime — Node utimes does not).
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import koffi from 'koffi'
import {
  buildStreamPath,
  parseBackupStreamName,
  validateStreamName
} from '@shared/ads/paths'
import { logMain } from '../logging'

const GENERIC_READ = 0x80000000
const FILE_READ_ATTRIBUTES = 0x0080
const FILE_WRITE_ATTRIBUTES = 0x0100
const FILE_SHARE_READ = 0x00000001
const FILE_SHARE_WRITE = 0x00000002
const FILE_SHARE_DELETE = 0x00000004
const OPEN_EXISTING = 3
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
const FILE_ATTRIBUTE_READONLY = 0x00000001
const INVALID_FILE_ATTRIBUTES = 0xffffffff
const INVALID_HANDLE_VALUE = -1n
const ERROR_FILE_NOT_FOUND = 2
const FileBasicInfo = 0
/** FILE_BASIC_INFO: 4×FILETIME + DWORD attrs + pad */
const FILE_BASIC_INFO_SIZE = 40

/** sizeof(WIN32_STREAM_ID) without the variable name: 20 bytes */
const STREAM_ID_SIZE = 20

export type AdsStreamInfo = {
  name: string
  size: number
  type: number
}

let api: {
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
  DeleteFileW: (name: string) => boolean
  GetFileAttributesW: (name: string) => number
  BackupRead: (
    hFile: unknown,
    buffer: Buffer,
    toRead: number,
    bytesRead: Buffer,
    abort: number,
    processSecurity: number,
    context: Buffer
  ) => boolean
  BackupSeek: (
    hFile: unknown,
    low: number,
    high: number,
    seekedLow: Buffer,
    seekedHigh: Buffer,
    context: Buffer
  ) => boolean
  GetFileInformationByHandleEx: (
    hFile: unknown,
    infoClass: number,
    info: Buffer,
    size: number
  ) => boolean
  SetFileInformationByHandle: (
    hFile: unknown,
    infoClass: number,
    info: Buffer,
    size: number
  ) => boolean
  SetFileAttributesW: (name: string, attrs: number) => boolean
  GetLastError: () => number
} | null = null

function ensureApi(): typeof api {
  if (api) return api
  if (process.platform !== 'win32') return null
  const kernel32 = koffi.load('kernel32.dll')
  api = {
    CreateFileW: kernel32.func(
      'void * __stdcall CreateFileW(str16 lpFileName, uint32 dwDesiredAccess, uint32 dwShareMode, void *lpSecurityAttributes, uint32 dwCreationDisposition, uint32 dwFlagsAndAttributes, void *hTemplateFile)'
    ) as NonNullable<typeof api>['CreateFileW'],
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *hObject)') as (
      h: unknown
    ) => boolean,
    DeleteFileW: kernel32.func('bool __stdcall DeleteFileW(str16 lpFileName)') as (
      name: string
    ) => boolean,
    GetFileAttributesW: kernel32.func(
      'uint32 __stdcall GetFileAttributesW(str16 lpFileName)'
    ) as (name: string) => number,
    BackupRead: kernel32.func(
      'bool __stdcall BackupRead(void *hFile, void *lpBuffer, uint32 nNumberOfBytesToRead, void *lpNumberOfBytesRead, int32 bAbort, int32 bProcessSecurity, void *lpContext)'
    ) as NonNullable<typeof api>['BackupRead'],
    BackupSeek: kernel32.func(
      'bool __stdcall BackupSeek(void *hFile, uint32 dwLowBytesToSeek, uint32 dwHighBytesToSeek, void *lpdwLowByteSeeked, void *lpdwHighByteSeeked, void *lpContext)'
    ) as NonNullable<typeof api>['BackupSeek'],
    GetFileInformationByHandleEx: kernel32.func(
      'int32 __stdcall GetFileInformationByHandleEx(void *hFile, int32 FileInformationClass, void *lpFileInformation, uint32 dwBufferSize)'
    ) as NonNullable<typeof api>['GetFileInformationByHandleEx'],
    SetFileInformationByHandle: kernel32.func(
      'int32 __stdcall SetFileInformationByHandle(void *hFile, int32 FileInformationClass, void *lpFileInformation, uint32 dwBufferSize)'
    ) as NonNullable<typeof api>['SetFileInformationByHandle'],
    SetFileAttributesW: kernel32.func(
      'int32 __stdcall SetFileAttributesW(str16 lpFileName, uint32 dwFileAttributes)'
    ) as NonNullable<typeof api>['SetFileAttributesW'],
    GetLastError: kernel32.func('uint32 __stdcall GetLastError()') as () => number
  }
  return api
}

function handleInvalid(h: unknown): boolean {
  if (h == null) return true
  if (typeof h === 'bigint') return h === INVALID_HANDLE_VALUE || h === 0xffffffffffffffffn
  if (typeof h === 'number') return h === -1 || h === 0xffffffff
  return false
}

function openForBackup(filePath: string): unknown | null {
  const n = ensureApi()
  if (!n) return null
  const h = n.CreateFileW(
    filePath,
    GENERIC_READ,
    FILE_SHARE_READ | FILE_SHARE_WRITE,
    null,
    OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS,
    null
  )
  if (handleInvalid(h)) return null
  return h
}

/**
 * List alternate data streams (excludes primary unnamed ::$DATA).
 * Soft-fail → [].
 */
export function listStreams(filePath: string): AdsStreamInfo[] {
  const n = ensureApi()
  if (!n) return []
  const hFile = openForBackup(filePath)
  if (!hFile) return []

  const result: AdsStreamInfo[] = []
  const header = Buffer.alloc(STREAM_ID_SIZE)
  const bytesRead = Buffer.alloc(4)
  // LPVOID* context — pointer-sized zeroed buffer (holds the context pointer value)
  const context = Buffer.alloc(8)
  context.writeBigUInt64LE(0n, 0)

  try {
    for (;;) {
      bytesRead.writeUInt32LE(0, 0)
      const ok = n.BackupRead(hFile, header, STREAM_ID_SIZE, bytesRead, 0, 0, context)
      const got = bytesRead.readUInt32LE(0)
      if (!ok || got !== STREAM_ID_SIZE) break

      const streamId = header.readUInt32LE(0)
      const streamNameSize = header.readUInt32LE(16)
      const sizeLow = header.readUInt32LE(8)
      const sizeHigh = header.readUInt32LE(12)
      const streamSize = sizeLow + sizeHigh * 0x100000000

      let name: string | null = null
      if (streamNameSize > 0) {
        const nameBuf = Buffer.alloc(streamNameSize)
        bytesRead.writeUInt32LE(0, 0)
        if (!n.BackupRead(hFile, nameBuf, streamNameSize, bytesRead, 0, 0, context)) break
        const chars = bytesRead.readUInt32LE(0) >> 1
        const raw = nameBuf.toString('utf16le', 0, chars * 2)
        name = parseBackupStreamName(raw)
      }

      if (name) {
        result.push({ name, size: streamSize, type: streamId })
      }

      const seekedLow = Buffer.alloc(4)
      const seekedHigh = Buffer.alloc(4)
      if (!n.BackupSeek(hFile, sizeLow, sizeHigh, seekedLow, seekedHigh, context)) break
    }
  } catch (e) {
    logMain(
      'warn',
      `ADS listStreams failed: ${e instanceof Error ? e.message : String(e)} (${filePath})`
    )
  } finally {
    try {
      bytesRead.writeUInt32LE(0, 0)
      n.BackupRead(hFile, Buffer.alloc(0), 0, bytesRead, 1, 0, context)
    } catch {
      /* abort best-effort */
    }
    n.CloseHandle(hFile)
  }
  return result
}

export function listStreamNames(filePath: string): string[] {
  return listStreams(filePath).map((s) => s.name)
}

/** Union of alternate stream names on many paths (names only; soft-fail per path). */
export async function listStreamNamesMany(paths: string[]): Promise<string[]> {
  const seen = new Set<string>()
  const names: string[] = []
  let n = 0
  for (const filePath of paths) {
    n += 1
    if (n % 32 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
    try {
      for (const name of listStreamNames(filePath)) {
        if (!name) continue
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        names.push(name)
      }
    } catch {
      /* soft-fail */
    }
  }
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return names
}

export function streamExists(filePath: string, streamName: string): boolean {
  const n = ensureApi()
  if (!n) return false
  try {
    validateStreamName(streamName)
  } catch {
    return false
  }
  const streamPath = buildStreamPath(filePath, streamName)
  const attrs = n.GetFileAttributesW(streamPath)
  if (attrs === 0xffffffff) {
    const err = n.GetLastError()
    if (err !== ERROR_FILE_NOT_FOUND) {
      /* other errors → treat as missing for soft-fail */
    }
    return false
  }
  return true
}

function kernelPath(filePath: string): string {
  if (filePath.startsWith('\\\\?\\') || filePath.startsWith('\\\\.\\')) return filePath
  if (filePath.startsWith('\\\\')) return `\\\\?\\UNC\\${filePath.slice(2)}`
  return `\\\\?\\${filePath}`
}

type HostTimeSnap = { kind: 'basic'; buf: Buffer } | { kind: 'unix'; atimeMs: number; mtimeMs: number }

function openForTimes(filePath: string, write: boolean): unknown | null {
  const n = ensureApi()
  if (!n) return null
  const access = FILE_READ_ATTRIBUTES | (write ? FILE_WRITE_ATTRIBUTES : 0)
  const h = n.CreateFileW(
    kernelPath(filePath),
    access,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
    null,
    OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS,
    null
  )
  return handleInvalid(h) ? null : h
}

function captureBasicInfo(filePath: string): Buffer | null {
  const n = ensureApi()
  if (!n) return null
  const h = openForTimes(filePath, false)
  if (!h) return null
  const buf = Buffer.alloc(FILE_BASIC_INFO_SIZE)
  try {
    if (!n.GetFileInformationByHandleEx(h, FileBasicInfo, buf, FILE_BASIC_INFO_SIZE)) return null
    return buf
  } catch {
    return null
  } finally {
    n.CloseHandle(h)
  }
}

function applyBasicInfo(filePath: string, buf: Buffer): boolean {
  const n = ensureApi()
  if (!n) return false
  const write = (): boolean => {
    const h = openForTimes(filePath, true)
    if (!h) return false
    try {
      return !!n.SetFileInformationByHandle(h, FileBasicInfo, buf, FILE_BASIC_INFO_SIZE)
    } catch {
      return false
    } finally {
      n.CloseHandle(h)
    }
  }
  if (write()) return true
  const attrs = n.GetFileAttributesW(kernelPath(filePath))
  if (attrs === INVALID_FILE_ATTRIBUTES || (attrs & FILE_ATTRIBUTE_READONLY) === 0) return false
  if (!n.SetFileAttributesW(kernelPath(filePath), attrs & ~FILE_ATTRIBUTE_READONLY)) return false
  try {
    return write()
  } finally {
    n.SetFileAttributesW(kernelPath(filePath), attrs)
  }
}

function readHostTimesSync(filePath: string): HostTimeSnap | null {
  const buf = captureBasicInfo(filePath)
  if (buf) return { kind: 'basic', buf }
  try {
    const st = fs.statSync(filePath)
    return { kind: 'unix', atimeMs: st.atimeMs, mtimeMs: st.mtimeMs }
  } catch {
    return null
  }
}

function restoreHostTimesSync(filePath: string, snap: HostTimeSnap): void {
  try {
    if (snap.kind === 'basic' && applyBasicInfo(filePath, snap.buf)) return
    const atimeMs =
      snap.kind === 'unix' ? snap.atimeMs : fileTimeToUnixMs(snap.buf.readBigInt64LE(8))
    const mtimeMs =
      snap.kind === 'unix' ? snap.mtimeMs : fileTimeToUnixMs(snap.buf.readBigInt64LE(16))
    fs.utimesSync(filePath, new Date(atimeMs), new Date(mtimeMs))
  } catch (e) {
    logMain(
      'warn',
      `ADS restoreHostTimes failed: ${e instanceof Error ? e.message : String(e)} (${filePath})`
    )
  }
}

async function readHostTimes(filePath: string): Promise<HostTimeSnap | null> {
  return readHostTimesSync(filePath)
}

async function restoreHostTimes(filePath: string, snap: HostTimeSnap): Promise<void> {
  restoreHostTimesSync(filePath, snap)
}

/** FILETIME (100ns since 1601) → Unix ms. Exported for tests. */
export function fileTimeToUnixMs(ft: bigint): number {
  const unix100ns = ft - 116444736000000000n
  return Number(unix100ns / 10000n)
}

/**
 * Run an ADS mutation without leaving the host file/dir timestamps at "now".
 * Restores NTFS Creation / Access / Write / **Change** times (FileBasicInfo).
 * Node `utimes` is not enough: it leaves ChangeTime at now, which sync tools treat as a file change.
 */
export async function withPreservedHostTimes<T>(
  filePath: string,
  fn: () => Promise<T>
): Promise<T> {
  const saved = await readHostTimes(filePath)
  try {
    return await fn()
  } finally {
    if (saved) await restoreHostTimes(filePath, saved)
  }
}

function deleteStreamUnchecked(filePath: string, streamName: string): boolean {
  const n = ensureApi()
  if (!n) return false
  validateStreamName(streamName)
  const streamPath = buildStreamPath(filePath, streamName)
  if (!streamExists(filePath, streamName)) return false
  const ok = n.DeleteFileW(streamPath)
  if (!ok) {
    const err = n.GetLastError()
    if (err !== ERROR_FILE_NOT_FOUND) {
      throw new Error(`DeleteFile failed for ADS (${err}): ${streamPath}`)
    }
    return false
  }
  return true
}

export function deleteStream(
  filePath: string,
  streamName: string,
  opts?: { preserveHostTimes?: boolean }
): boolean {
  if (opts?.preserveHostTimes === false) {
    return deleteStreamUnchecked(filePath, streamName)
  }
  const saved = readHostTimesSync(filePath)
  try {
    return deleteStreamUnchecked(filePath, streamName)
  } finally {
    if (saved) restoreHostTimesSync(filePath, saved)
  }
}

/** Trim ADS.cs Load conventions: trailing CR/LF/NUL, cut at first NUL. */
export function normalizeLoadedAdsText(raw: string): string {
  let s = raw
  const idx0 = s.indexOf('\0')
  if (idx0 >= 0) s = s.slice(0, idx0)
  while (s.endsWith('\r') || s.endsWith('\n')) s = s.slice(0, -1)
  return s
}

export async function readStreamBytes(filePath: string, streamName: string): Promise<Buffer | null> {
  validateStreamName(streamName)
  if (!streamExists(filePath, streamName)) return null
  const streamPath = buildStreamPath(filePath, streamName)
  try {
    return await fsp.readFile(streamPath)
  } catch {
    return null
  }
}

export async function writeStreamBytes(
  filePath: string,
  streamName: string,
  data: Buffer,
  opts?: { preserveHostTimes?: boolean }
): Promise<void> {
  validateStreamName(streamName)
  const write = async (): Promise<void> => {
    const streamPath = buildStreamPath(filePath, streamName)
    // Recreate like ADS.cs folder Save (delete then create)
    if (streamExists(filePath, streamName)) {
      try {
        deleteStreamUnchecked(filePath, streamName)
      } catch {
        /* continue */
      }
    }
    await fsp.writeFile(streamPath, data)
  }
  if (opts?.preserveHostTimes === false) {
    await write()
    return
  }
  await withPreservedHostTimes(filePath, write)
}

export async function readStreamText(filePath: string, streamName: string): Promise<string> {
  const buf = await readStreamBytes(filePath, streamName)
  if (!buf) return ''
  return normalizeLoadedAdsText(buf.toString('utf8'))
}

export async function writeStreamText(
  filePath: string,
  streamName: string,
  value: string,
  writeEmpty = false,
  opts?: { preserveHostTimes?: boolean }
): Promise<void> {
  validateStreamName(streamName)
  if (value === '' && !writeEmpty) {
    if (streamExists(filePath, streamName)) deleteStream(filePath, streamName, opts)
    return
  }
  // ADS.cs file Save writes value + '\0' via WriteLine(value+'\0') → value\0\r\n
  const payload = Buffer.from(`${value}\0\r\n`, 'utf8')
  await writeStreamBytes(filePath, streamName, payload, opts)
}

export async function copyStreams(
  sourcePath: string,
  destPath: string,
  ignoreNames?: string[],
  /** When true, skip that stream (in addition to `ignoreNames`). */
  ignorePred?: (name: string) => boolean
): Promise<number> {
  const ignore = new Set((ignoreNames ?? []).map((n) => n.toLowerCase()))
  const streams = listStreams(sourcePath)
  let copied = 0
  for (const s of streams) {
    if (ignore.has(s.name.toLowerCase())) continue
    if (ignorePred?.(s.name)) continue
    const data = await readStreamBytes(sourcePath, s.name)
    if (!data) continue
    await writeStreamBytes(destPath, s.name, data)
    copied += 1
  }
  return copied
}

/** Re-export path helpers for main callers. */
export { buildStreamPath, validateStreamName, parseBackupStreamName }
