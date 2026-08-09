import fsp from 'node:fs/promises'
import koffi from 'koffi'
import type { DriveInfo } from '@shared/schemas/fs'
import { AppError } from '@shared/result'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
/** NTFS / FAT volume label max length. */
export const VOLUME_NAME_MAX = 32

type VolumeApi = {
  GetVolumeInformationW: (
    root: string,
    nameBuf: Buffer,
    nameSize: number,
    serial: null,
    maxComp: null,
    flags: null,
    fsBuf: null,
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

function driveLabel(letter: string, volumeName: string): string {
  return volumeName ? `${letter}: \u2014 ${volumeName}` : `${letter}:`
}

export async function listDrives(): Promise<DriveInfo[]> {
  if (process.platform !== 'win32') {
    return [{ path: '/', label: '/', volumeName: '' }]
  }
  const results = await Promise.allSettled(
    LETTERS.map(async (letter) => {
      const root = `${letter}:\\`
      await fsp.access(root)
      const volumeName = readVolumeName(root)
      return { path: root, label: driveLabel(letter, volumeName), volumeName }
    })
  )
  return results
    .filter((r): r is PromiseFulfilledResult<DriveInfo> => r.status === 'fulfilled')
    .map((r) => r.value)
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
