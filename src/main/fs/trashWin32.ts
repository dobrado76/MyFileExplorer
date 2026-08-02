/**
 * Send paths to the Windows Recycle Bin via SHFileOperationW + FOF_ALLOWUNDO.
 * Electron's shell.trashItem does not reliably use Recycle Bin semantics on Windows.
 */
import fs from 'node:fs'
import koffi from 'koffi'
import path from 'node:path'
import { AppError } from '@shared/result'

const FO_DELETE = 0x0003
const FOF_SILENT = 0x0004
const FOF_NOCONFIRMATION = 0x0010
const FOF_ALLOWUNDO = 0x0040
const FOF_NOERRORUI = 0x0400
const FOF_WANTNUKEWARNING = 0x4000

const DRIVE_REMOVABLE = 2
const DRIVE_FIXED = 3
const DRIVE_REMOTE = 4
const DRIVE_CDROM = 5
const DRIVE_RAMDISK = 6

const shell32 = koffi.load('shell32.dll')
const kernel32 = koffi.load('kernel32.dll')

/** Win64 layout with explicit pads (matches Windows SDK SHFILEOPSTRUCTW). */
const SHFILEOPSTRUCTW = koffi.struct('MfeSHFILEOPSTRUCTW', {
  hwnd: 'void *',
  wFunc: 'uint32',
  _pad0: 'uint32',
  pFrom: 'void *',
  pTo: 'void *',
  fFlags: 'uint16',
  _pad1: 'uint16',
  fAnyOperationsAborted: 'int32',
  hNameMappings: 'void *',
  lpszProgressTitle: 'void *'
})

const SHFileOperationW = shell32.func(
  'int __stdcall SHFileOperationW(_Inout_ MfeSHFILEOPSTRUCTW *lpFileOp)'
)
const GetDriveTypeW = kernel32.func('uint32 __stdcall GetDriveTypeW(str16 lpRootPathName)')

function toDoubleNullWide(paths: string[]): Buffer {
  const chars: number[] = []
  for (const p of paths) {
    const normalized = path.win32.normalize(p)
    for (let i = 0; i < normalized.length; i++) chars.push(normalized.charCodeAt(i))
    chars.push(0)
  }
  chars.push(0)
  return Buffer.from(Uint16Array.from(chars).buffer)
}

function rootForPath(p: string): string {
  const parsed = path.win32.parse(path.win32.resolve(p))
  if (parsed.root) return parsed.root.endsWith('\\') ? parsed.root : `${parsed.root}\\`
  return ''
}

export function volumeSupportsRecycleBin(filePath: string): boolean {
  const root = rootForPath(filePath)
  if (!root) return false
  const type = GetDriveTypeW(root) as number
  return type === DRIVE_FIXED || type === DRIVE_RAMDISK || type === DRIVE_REMOVABLE
}

function driveTypeLabel(filePath: string): string {
  const root = rootForPath(filePath)
  const type = root ? (GetDriveTypeW(root) as number) : 0
  switch (type) {
    case DRIVE_REMOTE:
      return 'network location'
    case DRIVE_CDROM:
      return 'optical drive'
    default:
      return 'this location'
  }
}

/**
 * Move one or more existing paths into the Recycle Bin.
 * Throws if the volume cannot recycle (won't silently permanent-delete).
 */
export function recyclePathsWin32(paths: string[]): void {
  if (paths.length === 0) return

  for (const p of paths) {
    if (!volumeSupportsRecycleBin(p)) {
      throw new AppError(
        'validation',
        `Cannot send to Recycle Bin from ${driveTypeLabel(p)}. Use Shift+Delete for permanent delete.`,
        'Shift+Delete permanently removes items that cannot go to the Recycle Bin.'
      )
    }
  }

  const fromBuf = toDoubleNullWide(paths)
  const op = {
    hwnd: null,
    wFunc: FO_DELETE,
    _pad0: 0,
    pFrom: fromBuf,
    pTo: null,
    fFlags: FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOF_WANTNUKEWARNING,
    _pad1: 0,
    fAnyOperationsAborted: 0,
    hNameMappings: null,
    lpszProgressTitle: null
  }

  const code = SHFileOperationW(op) as number
  if (op.fAnyOperationsAborted) {
    throw new AppError('cancelled', 'Delete was cancelled')
  }
  if (code !== 0) {
    throw new AppError(
      'io',
      `Could not move to Recycle Bin (shell error ${code})`,
      'Check that the Recycle Bin is enabled for this drive, or use Shift+Delete.'
    )
  }

  const stillThere = paths.filter((p) => fs.existsSync(p))
  if (stillThere.length > 0) {
    throw new AppError(
      'io',
      `Recycle Bin did not remove: ${path.basename(stillThere[0]!)}`,
      'The item may be in use, or the Recycle Bin is disabled for this drive.'
    )
  }
}
