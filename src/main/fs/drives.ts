import koffi from 'koffi'
import type { DriveInfo } from '@shared/schemas/fs'
import { AppError } from '@shared/result'

/** NTFS / FAT volume label max length. */
export const VOLUME_NAME_MAX = 32

const DRIVE_NO_ROOT_DIR = 1

type VolumeApi = {
  GetLogicalDriveStringsW: (nBufferLength: number, lpBuffer: Buffer) => number
  GetDriveTypeW: (lpRootPathName: string) => number
  GetVolumeInformationW: (
    root: string,
    nameBuf: Buffer | null,
    nameSize: number,
    serial: null,
    maxComp: null,
    flags: null,
    fsBuf: Buffer | null,
    fsSize: number
  ) => number
  SetVolumeLabelW: (root: string, name: string) => number
  GetLastError: () => number
}

let volumeApi: VolumeApi | null | undefined

function ensureVolumeApi(): VolumeApi | null {
  if (volumeApi !== undefined) return volumeApi
  if (process.platform !== 'win32') {
    volumeApi = null
    return null
  }
  const kernel32 = koffi.load('kernel32.dll')
  volumeApi = {
    GetLogicalDriveStringsW: kernel32.func(
      'uint32 __stdcall GetLogicalDriveStringsW(uint32 nBufferLength, void *lpBuffer)'
    ),
    GetDriveTypeW: kernel32.func('uint32 __stdcall GetDriveTypeW(str16 lpRootPathName)'),
    GetVolumeInformationW: kernel32.func(
      'int32 __stdcall GetVolumeInformationW(str16 lpRootPathName, void *lpVolumeNameBuffer, uint32 nVolumeNameSize, void *lpVolumeSerialNumber, void *lpMaximumComponentLength, void *lpFileSystemFlags, void *lpFileSystemNameBuffer, uint32 nFileSystemNameSize)'
    ),
    SetVolumeLabelW: kernel32.func(
      'int32 __stdcall SetVolumeLabelW(str16 lpRootPathName, str16 lpVolumeName)'
    ),
    GetLastError: kernel32.func('uint32 __stdcall GetLastError()')
  }
  return volumeApi
}

function normalizeDriveRoot(rootPath: string): string {
  const n = rootPath.replace(/\//g, '\\')
  const m = /^([a-zA-Z]:)\\?$/.exec(n)
  if (!m) return rootPath.endsWith('\\') ? rootPath : `${rootPath}\\`
  return `${m[1]!.toUpperCase()}\\`
}

/** Placeholders that must not appear next to the drive letter in the tree. */
export function isHiddenVolumeName(name: string): boolean {
  const t = name.trim()
  return !t || /^no name$/i.test(t) || /^new volume$/i.test(t)
}

/** Volume label from GetVolumeInformationW, or '' when unnamed / placeholder. */
export function readVolumeName(rootPath: string): string {
  const api = ensureVolumeApi()
  if (!api) return ''
  const root = normalizeDriveRoot(rootPath)
  const nameBuf = Buffer.alloc(261 * 2)
  const ok = api.GetVolumeInformationW(root, nameBuf, 261, null, null, null, null, 0)
  if (!ok) return ''
  const raw = nameBuf.toString('utf16le').replace(/\0.*$/s, '').trim()
  if (isHiddenVolumeName(raw)) return ''
  return raw
}

/** File system name for a drive root (`NTFS`, `FAT32`, …), or null when unknown. */
export function readFileSystemName(rootPath: string): string | null {
  const api = ensureVolumeApi()
  if (!api) return null
  const root = normalizeDriveRoot(rootPath)
  const fsBuf = Buffer.alloc(64 * 2)
  const ok = api.GetVolumeInformationW(root, null, 0, null, null, null, fsBuf, 64)
  if (!ok) return null
  const raw = fsBuf.toString('utf16le').replace(/\0.*$/s, '').trim()
  return raw || null
}

const ntfsPathCache = new Map<string, boolean>()

/**
 * True when `absPath` is on an NTFS volume (ADS-capable). Non-win32 / unknown → false.
 * Cached per drive root for bulk copy/move.
 */
export function pathIsNtfs(absPath: string): boolean {
  if (process.platform !== 'win32') return false
  const m = /^([a-zA-Z]:)/.exec(absPath.replace(/\//g, '\\'))
  if (!m) return false
  const root = `${m[1]!.toUpperCase()}\\`
  const cached = ntfsPathCache.get(root)
  if (cached !== undefined) return cached
  const fsName = readFileSystemName(root)
  const ok = (fsName ?? '').toUpperCase() === 'NTFS'
  ntfsPathCache.set(root, ok)
  return ok
}

function driveLabel(letter: string, volumeName: string): string {
  return volumeName ? `${letter}: \u2014 ${volumeName}` : `${letter}:`
}

/** Currently mounted roots from GetLogicalDriveStringsW (e.g. `C:\`). */
function logicalDriveRoots(api: VolumeApi): string[] {
  let chars = 128
  for (let attempt = 0; attempt < 3; attempt++) {
    const buf = Buffer.alloc(chars * 2)
    const needed = api.GetLogicalDriveStringsW(chars, buf)
    if (needed === 0) return []
    if (needed > chars) {
      chars = needed
      continue
    }
    const text = buf.toString('utf16le', 0, needed * 2)
    return text
      .split('\0')
      .map((s) => s.trim())
      .filter((s) => /^[a-zA-Z]:\\?$/.test(s))
      .map((s) => (s.endsWith('\\') ? s.toUpperCase() : `${s.toUpperCase()}\\`))
  }
  return []
}

/**
 * Live mounted volumes for the tree. Unmounted removable drives disappear here —
 * Offline retry belongs to tabs (session), not the Drives list.
 */
export async function listDrives(): Promise<DriveInfo[]> {
  if (process.platform !== 'win32') {
    return [{ path: '/', label: '/', volumeName: '' }]
  }
  const api = ensureVolumeApi()
  if (!api) return []

  const roots = logicalDriveRoots(api)
  const out: DriveInfo[] = []
  for (const root of roots) {
    const type = api.GetDriveTypeW(root)
    // Skip unknown / no-root (stale letters after eject).
    if (type <= DRIVE_NO_ROOT_DIR) continue
    const letter = root[0]!.toUpperCase()
    const volumeName = readVolumeName(root)
    out.push({ path: root, label: driveLabel(letter, volumeName), volumeName })
  }
  out.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }))
  return out
}

/** Set or clear (empty string) the Windows volume label for a drive root. */
export function setVolumeLabel(rootPath: string, name: string): { path: string; volumeName: string } {
  const api = ensureVolumeApi()
  if (!api) throw new AppError('io', 'Volume labels are only supported on Windows')
  const root = normalizeDriveRoot(rootPath)
  if (!/^[A-Z]:\\$/i.test(root)) {
    throw new AppError('validation', 'Not a drive root')
  }
  const trimmed = name.trim()
  if (trimmed.length > VOLUME_NAME_MAX) {
    throw new AppError('validation', `Volume name must be at most ${VOLUME_NAME_MAX} characters`)
  }
  if (/[<>:"/\\|?*]/.test(trimmed)) {
    throw new AppError('validation', 'Volume name contains invalid characters')
  }
  // Empty field → clear; if clear fails, fall back to the "New Volume" placeholder
  // (never shown in the tree — see isHiddenVolumeName).
  const clearing = isHiddenVolumeName(trimmed)
  const toSet = clearing ? '' : trimmed
  let ok = api.SetVolumeLabelW(root, toSet)
  if (!ok && clearing) {
    ok = api.SetVolumeLabelW(root, 'New Volume')
  }
  if (!ok) {
    const err = api.GetLastError()
    throw new AppError(
      'io',
      err === 5
        ? 'Access denied — try running as administrator or check the volume is writable'
        : `Could not set volume name (error ${err})`
    )
  }
  const volumeName = readVolumeName(root)
  return { path: root, volumeName }
}
