/** Fast Windows file-attribute get/set (no `attrib.exe` spawn). */
import path from 'node:path'
import koffi from 'koffi'
import { AppError } from '@shared/result'

export const FILE_ATTRIBUTE_READONLY = 0x1
export const FILE_ATTRIBUTE_HIDDEN = 0x2
export const FILE_ATTRIBUTE_SYSTEM = 0x4
export const FILE_ATTRIBUTE_DIRECTORY = 0x10
export const FILE_ATTRIBUTE_ARCHIVE = 0x20
export const FILE_ATTRIBUTE_NORMAL = 0x80
const INVALID_FILE_ATTRIBUTES = 0xffffffff

type KernelApi = {
  GetFileAttributesW: (lpFileName: string) => number
  SetFileAttributesW: (lpFileName: string, dwFileAttributes: number) => number
}

let api: KernelApi | null | undefined

function ensureApi(): KernelApi | null {
  if (api !== undefined) return api
  if (process.platform !== 'win32') {
    api = null
    return null
  }
  const kernel32 = koffi.load('kernel32.dll')
  api = {
    GetFileAttributesW: kernel32.func('uint32 __stdcall GetFileAttributesW(str16 lpFileName)'),
    SetFileAttributesW: kernel32.func(
      'int32 __stdcall SetFileAttributesW(str16 lpFileName, uint32 dwFileAttributes)'
    )
  }
  return api
}

export function getFileAttributes(absPath: string): number | null {
  const k = ensureApi()
  if (!k) return null
  const attrs = k.GetFileAttributesW(absPath)
  if (attrs === INVALID_FILE_ATTRIBUTES) return null
  return attrs
}

/**
 * True when the path should render as Explorer-style “hidden” (ghosted).
 * On Windows: FILE_ATTRIBUTE_HIDDEN only — a leading `.` does not mean hidden.
 * Elsewhere: Unix-style dotfiles.
 */
export function pathIsHidden(absPath: string): boolean {
  const attrs = getFileAttributes(absPath)
  if (attrs === null) {
    return process.platform !== 'win32' && path.basename(absPath).startsWith('.')
  }
  return (attrs & FILE_ATTRIBUTE_HIDDEN) !== 0
}

export type WinAttrFlags = {
  readOnly: boolean
  hidden: boolean
  system: boolean
  archive: boolean
}

export function flagsFromAttributes(attrs: number): WinAttrFlags {
  return {
    readOnly: (attrs & FILE_ATTRIBUTE_READONLY) !== 0,
    hidden: (attrs & FILE_ATTRIBUTE_HIDDEN) !== 0,
    system: (attrs & FILE_ATTRIBUTE_SYSTEM) !== 0,
    archive: (attrs & FILE_ATTRIBUTE_ARCHIVE) !== 0
  }
}

export function getWinAttributeFlags(absPath: string): WinAttrFlags | null {
  const attrs = getFileAttributes(absPath)
  if (attrs === null) return null
  return flagsFromAttributes(attrs)
}

export function pathIsReadOnly(absPath: string): boolean {
  return getWinAttributeFlags(absPath)?.readOnly === true
}

/**
 * Run `fn` with FILE_ATTRIBUTE_READONLY temporarily cleared (restored afterward).
 * Volume roots and some folders report Read-only via GetFileAttributes even when
 * Explorer does not expose a usable checkbox — ADS writes still need the bit off.
 */
export async function withClearedReadOnlyAttribute<T>(
  absPath: string,
  fn: () => Promise<T>
): Promise<T> {
  const k = ensureApi()
  if (!k) return fn()
  const attrs = k.GetFileAttributesW(absPath)
  if (attrs === INVALID_FILE_ATTRIBUTES || (attrs & FILE_ATTRIBUTE_READONLY) === 0) {
    return fn()
  }
  if (!k.SetFileAttributesW(absPath, attrs & ~FILE_ATTRIBUTE_READONLY)) {
    return fn()
  }
  try {
    return await fn()
  } finally {
    k.SetFileAttributesW(absPath, attrs)
  }
}

export function attributeLabels(flags: WinAttrFlags): string[] {
  const out: string[] = []
  if (flags.readOnly) out.push('Read-only')
  if (flags.hidden) out.push('Hidden')
  if (flags.system) out.push('System')
  if (flags.archive) out.push('Archive')
  return out
}

/** Apply Read-only / Hidden / System / Archive; preserve Directory and other bits. */
export function setWinAttributeFlags(absPath: string, flags: WinAttrFlags): WinAttrFlags {
  const k = ensureApi()
  if (!k) {
    throw new AppError('not-allowed', 'Changing attributes is only supported on Windows')
  }
  const cur = k.GetFileAttributesW(absPath)
  if (cur === INVALID_FILE_ATTRIBUTES) {
    throw new AppError('io', `Could not read attributes for ${path.basename(absPath)}`)
  }
  let next =
    cur &
    ~(
      FILE_ATTRIBUTE_READONLY |
      FILE_ATTRIBUTE_HIDDEN |
      FILE_ATTRIBUTE_SYSTEM |
      FILE_ATTRIBUTE_ARCHIVE |
      FILE_ATTRIBUTE_NORMAL
    )
  if (flags.readOnly) next |= FILE_ATTRIBUTE_READONLY
  if (flags.hidden) next |= FILE_ATTRIBUTE_HIDDEN
  if (flags.system) next |= FILE_ATTRIBUTE_SYSTEM
  if (flags.archive) next |= FILE_ATTRIBUTE_ARCHIVE
  if (next === 0) next = FILE_ATTRIBUTE_NORMAL
  if (!k.SetFileAttributesW(absPath, next)) {
    throw new AppError(
      'not-allowed',
      `Could not change attributes for ${path.basename(absPath)}`,
      'You may need permission, or the file may be in use.'
    )
  }
  const after = k.GetFileAttributesW(absPath)
  if (after === INVALID_FILE_ATTRIBUTES) return flags
  return flagsFromAttributes(after)
}
