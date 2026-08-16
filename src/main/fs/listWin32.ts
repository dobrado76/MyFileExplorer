/**
 * Fast directory listing via FindFirstFileW / FindNextFileW.
 * One pass yields name, attributes, size, and mtimes — no per-file stat /
 * GetFileAttributes (those were ~2 syscalls × N and made 20k folders multi-second).
 */
import path from 'node:path'
import koffi from 'koffi'
import type { DirEntry } from '@shared/schemas/fs'

const FILE_ATTRIBUTE_HIDDEN = 0x2
const FILE_ATTRIBUTE_SYSTEM = 0x4
const FILE_ATTRIBUTE_DIRECTORY = 0x10
const FILE_ATTRIBUTE_REPARSE_POINT = 0x400
/** sizeof(WIN32_FIND_DATAW) */
const FIND_DATA_SIZE = 592
const INVALID_HANDLE = 0xffffffffffffffffn

type WinFindApis = {
  FindFirstFileW: (lpFileName: string, lpFindFileData: Buffer) => unknown
  FindNextFileW: (hFindFile: unknown, lpFindFileData: Buffer) => number
  FindClose: (hFindFile: unknown) => number
}

let winFindApis: WinFindApis | null | undefined

function ensureWinFindApis(): WinFindApis | null {
  if (winFindApis !== undefined) return winFindApis
  if (process.platform !== 'win32') {
    winFindApis = null
    return null
  }
  const kernel32 = koffi.load('kernel32.dll')
  winFindApis = {
    FindFirstFileW: kernel32.func(
      'void * __stdcall FindFirstFileW(str16 lpFileName, void *lpFindFileData)'
    ) as WinFindApis['FindFirstFileW'],
    FindNextFileW: kernel32.func(
      'int32 __stdcall FindNextFileW(void *hFindFile, void *lpFindFileData)'
    ) as WinFindApis['FindNextFileW'],
    FindClose: kernel32.func('int32 __stdcall FindClose(void *hFindFile)') as WinFindApis['FindClose']
  }
  return winFindApis
}

function isInvalidHandle(h: unknown): boolean {
  if (h == null) return true
  if (typeof h === 'bigint') return h === INVALID_HANDLE || h === -1n
  if (typeof h === 'number') return h === -1 || h === 0xffffffff
  return false
}

function readU32(buf: Buffer, off: number): number {
  return buf.readUInt32LE(off)
}

function fileTimeToMs(buf: Buffer, off: number): number {
  const low = BigInt(buf.readUInt32LE(off))
  const high = BigInt(buf.readUInt32LE(off + 4))
  const ticks = (high << 32n) + low
  if (ticks === 0n) return 0
  return Number(ticks / 10000n - 11644473600000n)
}

function readName(buf: Buffer): string {
  // WIN32_FIND_DATAW.cFileName @ offset 44
  const chars: number[] = []
  for (let i = 0; i < 260; i++) {
    const c = buf.readUInt16LE(44 + i * 2)
    if (c === 0) break
    chars.push(c)
  }
  return String.fromCharCode(...chars)
}

function extOf(name: string): string {
  const e = path.extname(name)
  return e.startsWith('.') ? e.slice(1).toLowerCase() : e.toLowerCase()
}

/** Join under a dir without collapsing UNC `\\server` via path.join. */
function joinUnder(dirPath: string, name: string): string {
  const base = dirPath.replace(/[\\/]+$/, '')
  return `${base}\\${name}`
}

/**
 * List a directory with FindFirstFileW. Returns null if the API fails so the
 * caller can fall back to readdir+stat.
 */
export function listDirectoryWin32(dirPath: string, includeHidden: boolean): DirEntry[] | null {
  const apis = ensureWinFindApis()
  if (!apis) return null

  const pattern = dirPath.endsWith('\\') || dirPath.endsWith('/') ? `${dirPath}*` : `${dirPath}\\*`
  const buf = Buffer.alloc(FIND_DATA_SIZE)
  const handle = apis.FindFirstFileW(pattern, buf)
  if (isInvalidHandle(handle)) return null

  const entries: DirEntry[] = []
  try {
    for (;;) {
      const name = readName(buf)
      if (name !== '.' && name !== '..') {
        const attrs = readU32(buf, 0)
        const isHidden = (attrs & FILE_ATTRIBUTE_HIDDEN) !== 0
        if (!isHidden || includeHidden) {
          const isDir = (attrs & FILE_ATTRIBUTE_DIRECTORY) !== 0
          const isReparse = (attrs & FILE_ATTRIBUTE_REPARSE_POINT) !== 0
          const kind: DirEntry['kind'] = isDir ? 'dir' : isReparse ? 'symlink' : 'file'
          const sizeHigh = readU32(buf, 28)
          const sizeLow = readU32(buf, 32)
          const size = isDir ? 0 : sizeHigh * 0x1_0000_0000 + sizeLow
          entries.push({
            name,
            path: joinUnder(dirPath, name),
            kind,
            size,
            mtimeMs: fileTimeToMs(buf, 20), // ftLastWriteTime
            birthtimeMs: fileTimeToMs(buf, 4), // ftCreationTime
            ext: kind === 'dir' ? '' : extOf(name),
            isHidden
          })
        }
      }
      if (!apis.FindNextFileW(handle, buf)) break
    }
  } finally {
    apis.FindClose(handle)
  }
  return entries
}

/** One FindFirstFile pass: name, size, Hidden/System — does not open file contents. */
export type StatsScanEntry = {
  name: string
  path: string
  isDir: boolean
  isReparse: boolean
  size: number
  hidden: boolean
  system: boolean
}

/**
 * Directory listing for Calculate Statistics. Size comes from WIN32_FIND_DATA
 * (no per-file CreateFile / stat). Returns null if the API fails.
 */
export function listDirectoryForStats(dirPath: string): StatsScanEntry[] | null {
  const apis = ensureWinFindApis()
  if (!apis) return null

  const pattern = dirPath.endsWith('\\') || dirPath.endsWith('/') ? `${dirPath}*` : `${dirPath}\\*`
  const buf = Buffer.alloc(FIND_DATA_SIZE)
  const handle = apis.FindFirstFileW(pattern, buf)
  if (isInvalidHandle(handle)) return null

  const entries: StatsScanEntry[] = []
  try {
    for (;;) {
      const name = readName(buf)
      if (name !== '.' && name !== '..') {
        const attrs = readU32(buf, 0)
        const isDir = (attrs & FILE_ATTRIBUTE_DIRECTORY) !== 0
        const sizeHigh = readU32(buf, 28)
        const sizeLow = readU32(buf, 32)
        entries.push({
          name,
          path: joinUnder(dirPath, name),
          isDir,
          isReparse: (attrs & FILE_ATTRIBUTE_REPARSE_POINT) !== 0,
          size: isDir ? 0 : sizeHigh * 0x1_0000_0000 + sizeLow,
          hidden: (attrs & FILE_ATTRIBUTE_HIDDEN) !== 0,
          system: (attrs & FILE_ATTRIBUTE_SYSTEM) !== 0
        })
      }
      if (!apis.FindNextFileW(handle, buf)) break
    }
  } finally {
    apis.FindClose(handle)
  }
  return entries
}
