/**
 * Send paths to the Windows Recycle Bin.
 *
 * Fast path first (D7 — must land in Recycle Bin, never silent permanent delete):
 * 1. SHFileOperationW + FOF_ALLOWUNDO (sync, typically <50ms)
 * 2. Electron shell.trashItem (IFileOperation)
 * 3. VisualBasic SendToRecycleBin via PowerShell (slow cold-start — last resort only)
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import koffi from 'koffi'
import path from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'
import { AppError } from '@shared/result'

const execFileAsync = promisify(execFile)

const FO_DELETE = 0x0003
const FOF_SILENT = 0x0004
const FOF_NOCONFIRMATION = 0x0010
const FOF_ALLOWUNDO = 0x0040
const FOF_NOERRORUI = 0x0400

const DRIVE_REMOVABLE = 2
const DRIVE_FIXED = 3
const DRIVE_REMOTE = 4
const DRIVE_CDROM = 5
const DRIVE_RAMDISK = 6

type WinShellApi = {
  SHFileOperationW: (op: Record<string, unknown>) => number
  GetDriveTypeW: (lpRootPathName: string) => number
}

let winShellApi: WinShellApi | null | undefined

function ensureWinShellApi(): WinShellApi | null {
  if (winShellApi !== undefined) return winShellApi
  if (process.platform !== 'win32') {
    winShellApi = null
    return null
  }
  const shell32 = koffi.load('shell32.dll')
  const kernel32 = koffi.load('kernel32.dll')

  /** Win64 layout with explicit pads (matches Windows SDK SHFILEOPSTRUCTW). */
  koffi.struct('MfeSHFILEOPSTRUCTW', {
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

  winShellApi = {
    SHFileOperationW: shell32.func(
      'int __stdcall SHFileOperationW(_Inout_ MfeSHFILEOPSTRUCTW *lpFileOp)'
    ) as WinShellApi['SHFileOperationW'],
    GetDriveTypeW: kernel32.func('uint32 __stdcall GetDriveTypeW(str16 lpRootPathName)') as WinShellApi['GetDriveTypeW']
  }
  return winShellApi
}

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
  const api = ensureWinShellApi()
  if (!api) return false
  const root = rootForPath(filePath)
  if (!root) return false
  const type = api.GetDriveTypeW(root) as number
  return type === DRIVE_FIXED || type === DRIVE_RAMDISK || type === DRIVE_REMOVABLE
}

function driveTypeLabel(filePath: string): string {
  const api = ensureWinShellApi()
  const root = rootForPath(filePath)
  const type = root && api ? (api.GetDriveTypeW(root) as number) : 0
  switch (type) {
    case DRIVE_REMOTE:
      return 'network location'
    case DRIVE_CDROM:
      return 'optical drive'
    default:
      return 'this location'
  }
}

function shellErrorMessage(code: number): { message: string; remediation: string } {
  switch (code) {
    case 2:
    case 3:
      return {
        message: 'Could not move to Recycle Bin — the item was not found.',
        remediation: 'Refresh and try again.'
      }
    case 5:
    case 0x78:
    case 0x79:
      return {
        message: 'Could not move to Recycle Bin — access denied.',
        remediation: 'Check permissions, or use Shift+Delete for permanent remove.'
      }
    case 32:
    case 33:
      return {
        message: 'Could not move to Recycle Bin — the item is in use.',
        remediation:
          'Close preview/programs using it, then try again. Shift+Delete may still work.'
      }
    case 0x7c:
      return {
        message: 'Could not move to Recycle Bin — invalid path or name.',
        remediation: 'Try Shift+Delete, or check that the path is still valid.'
      }
    default:
      return {
        message: `Could not move to Recycle Bin (shell error ${code})`,
        remediation:
          'Confirm the Recycle Bin is enabled for this drive. Shift+Delete permanently removes the item if recycle is unavailable.'
      }
  }
}

function stillExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath)
    return true
  } catch {
    return false
  }
}

function assertGone(filePath: string): void {
  if (stillExists(filePath)) {
    throw new AppError(
      'io',
      `Recycle Bin did not remove: ${path.basename(filePath)}`,
      'The Recycle Bin may be disabled for this drive, or the shell refused the move. Shift+Delete permanently removes the item.'
    )
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function runShFileRecycle(filePath: string): void {
  const api = ensureWinShellApi()
  if (!api) {
    throw new AppError('not-allowed', 'Recycle Bin is only supported on Windows')
  }
  const fromBuf = toDoubleNullWide([filePath])
  const op = {
    hwnd: null,
    wFunc: FO_DELETE,
    _pad0: 0,
    pFrom: fromBuf,
    pTo: null,
    fFlags: FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI,
    _pad1: 0,
    fAnyOperationsAborted: 0,
    hNameMappings: null,
    lpszProgressTitle: null
  }

  const code = api.SHFileOperationW(op) as number
  if (code !== 0) {
    const mapped = shellErrorMessage(code)
    throw new AppError('io', mapped.message, mapped.remediation)
  }
  assertGone(filePath)
}

async function recycleViaVisualBasic(filePath: string): Promise<void> {
  let isDir: boolean
  try {
    isDir = (await fsp.stat(filePath)).isDirectory()
  } catch {
    throw new AppError('not-found', `Not found: ${filePath}`)
  }
  const method = isDir ? 'DeleteDirectory' : 'DeleteFile'
  const literal = filePath.replace(/'/g, "''")
  const ps = [
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    `[Microsoft.VisualBasic.FileIO.FileSystem]::${method}(`,
    `  '${literal}',`,
    '  [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,',
    '  [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin,',
    '  [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException',
    ')'
  ].join('\n')

  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 180_000, maxBuffer: 1024 * 1024 }
    )
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new AppError(
      'io',
      `Could not move to Recycle Bin: ${path.basename(filePath)}`,
      detail.toLowerCase().includes('cancel')
        ? 'Delete was cancelled.'
        : 'Shift+Delete permanently removes the item if the Recycle Bin cannot accept it.'
    )
  }
  assertGone(filePath)
}

async function recycleViaElectronShell(filePath: string): Promise<void> {
  await shell.trashItem(filePath)
  if (!stillExists(filePath)) return
  // trashItem sometimes returns before the rename is visible — one short check.
  await sleep(25)
  assertGone(filePath)
}

function ensureRecyclable(filePath: string): void {
  if (!volumeSupportsRecycleBin(filePath)) {
    throw new AppError(
      'validation',
      `Cannot send to Recycle Bin from ${driveTypeLabel(filePath)}. Use Shift+Delete for permanent delete.`,
      'Shift+Delete permanently removes items that cannot go to the Recycle Bin.'
    )
  }
}

/**
 * Move paths into the Recycle Bin (sync SHFileOperation attempt).
 * Prefer {@link recyclePathWin32Robust} from async callers.
 */
export function recyclePathsWin32(paths: string[]): void {
  if (paths.length === 0) return
  for (const p of paths) {
    ensureRecyclable(p)
    runShFileRecycle(p)
  }
}

/**
 * Robust single-path recycle: SH (fast) → Electron IFileOperation → VB (slow).
 */
export async function recyclePathWin32Robust(filePath: string): Promise<void> {
  ensureRecyclable(filePath)
  if (!stillExists(filePath)) return

  const errors: string[] = []

  try {
    runShFileRecycle(filePath)
    return
  } catch (e) {
    if (!stillExists(filePath)) return
    if (e instanceof AppError && e.code === 'validation') throw e
    errors.push(e instanceof Error ? e.message : String(e))
  }

  try {
    await recycleViaElectronShell(filePath)
    return
  } catch (e) {
    if (!stillExists(filePath)) return
    errors.push(e instanceof Error ? e.message : String(e))
  }

  try {
    await recycleViaVisualBasic(filePath)
    return
  } catch (e) {
    if (!stillExists(filePath)) return
    errors.push(e instanceof Error ? e.message : String(e))
  }

  throw new AppError(
    'io',
    `Could not move to Recycle Bin: ${path.basename(filePath)}`,
    errors.filter(Boolean).slice(-1)[0] ??
      'Shift+Delete permanently removes the item if the Recycle Bin cannot accept it.'
  )
}
