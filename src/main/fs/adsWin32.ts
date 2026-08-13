/**
 * NTFS Alternate Data Streams — Trinet.Core.IO.Ntfs / ADS.cs parity (koffi).
 * Soft-fails on non-win32 / access denied / non-NTFS.
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
const FILE_SHARE_READ = 0x00000001
const FILE_SHARE_WRITE = 0x00000002
const OPEN_EXISTING = 3
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
const INVALID_HANDLE_VALUE = -1n
const ERROR_FILE_NOT_FOUND = 2

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

function readHostTimesSync(filePath: string): { atimeMs: number; mtimeMs: number } | null {
  try {
    const st = fs.statSync(filePath)
    return { atimeMs: st.atimeMs, mtimeMs: st.mtimeMs }
  } catch {
    return null
  }
}

function restoreHostTimesSync(filePath: string, atimeMs: number, mtimeMs: number): void {
  try {
    fs.utimesSync(filePath, new Date(atimeMs), new Date(mtimeMs))
  } catch (e) {
    logMain(
      'warn',
      `ADS restoreHostTimes failed: ${e instanceof Error ? e.message : String(e)} (${filePath})`
    )
  }
}

async function readHostTimes(
  filePath: string
): Promise<{ atimeMs: number; mtimeMs: number } | null> {
  try {
    const st = await fsp.stat(filePath)
    return { atimeMs: st.atimeMs, mtimeMs: st.mtimeMs }
  } catch {
    return null
  }
}

async function restoreHostTimes(
  filePath: string,
  atimeMs: number,
  mtimeMs: number
): Promise<void> {
  try {
    await fsp.utimes(filePath, new Date(atimeMs), new Date(mtimeMs))
  } catch (e) {
    logMain(
      'warn',
      `ADS restoreHostTimes failed: ${e instanceof Error ? e.message : String(e)} (${filePath})`
    )
  }
}

/**
 * Run an ADS mutation without leaving the host file/dir mtime (or atime) at "now".
 * NTFS ADS writes otherwise bump last-modified — undesirable for bulk statistics.
 */
export async function withPreservedHostTimes<T>(
  filePath: string,
  fn: () => Promise<T>
): Promise<T> {
  const saved = await readHostTimes(filePath)
  try {
    return await fn()
  } finally {
    if (saved) await restoreHostTimes(filePath, saved.atimeMs, saved.mtimeMs)
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

export function deleteStream(filePath: string, streamName: string): boolean {
  const saved = readHostTimesSync(filePath)
  try {
    return deleteStreamUnchecked(filePath, streamName)
  } finally {
    if (saved) restoreHostTimesSync(filePath, saved.atimeMs, saved.mtimeMs)
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
  data: Buffer
): Promise<void> {
  validateStreamName(streamName)
  await withPreservedHostTimes(filePath, async () => {
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
  })
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
  writeEmpty = false
): Promise<void> {
  validateStreamName(streamName)
  if (value === '' && !writeEmpty) {
    if (streamExists(filePath, streamName)) deleteStream(filePath, streamName)
    return
  }
  // ADS.cs file Save writes value + '\0' via WriteLine(value+'\0') → value\0\r\n
  const payload = Buffer.from(`${value}\0\r\n`, 'utf8')
  await writeStreamBytes(filePath, streamName, payload)
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
