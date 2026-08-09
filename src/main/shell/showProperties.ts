/**
 * Open the system Explorer property sheet (Security, Sharing, Details, …).
 * ShellExecuteW("properties") is unreliable; ShellExecuteExW + SEE_MASK_INVOKEIDLIST
 * matches how Explorer invokes the verb.
 */
import koffi from 'koffi'
import { requireAbsolute, pathExists } from '../fs/list'
import { AppError } from '@shared/result'

const SW_SHOW = 5
/** Use IContextMenu / IDList path so the "properties" verb resolves. */
const SEE_MASK_INVOKEIDLIST = 0x0000000c

koffi.struct('MfeSHELLEXECUTEINFOW', {
  cbSize: 'uint32',
  fMask: 'uint32',
  hwnd: 'void *',
  lpVerb: 'void *',
  lpFile: 'void *',
  lpParameters: 'void *',
  lpDirectory: 'void *',
  nShow: 'int32',
  hInstApp: 'void *',
  lpIDList: 'void *',
  lpClass: 'void *',
  hkeyClass: 'void *',
  dwHotKey: 'uint32',
  hIconOrMonitor: 'void *',
  hProcess: 'void *'
})

type ShellExecuteExFn = (pExecInfo: Record<string, unknown>) => boolean

let ShellExecuteExW: ShellExecuteExFn | null = null
let infoSize = 0

function ensureShellExecuteEx(): ShellExecuteExFn {
  if (ShellExecuteExW) return ShellExecuteExW
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'Windows Properties is only available on Windows')
  }
  const shell32 = koffi.load('shell32.dll')
  ShellExecuteExW = shell32.func(
    'bool __stdcall ShellExecuteExW(_Inout_ MfeSHELLEXECUTEINFOW *pExecInfo)'
  ) as ShellExecuteExFn
  infoSize = koffi.sizeof('MfeSHELLEXECUTEINFOW')
  return ShellExecuteExW
}

function wideZ(s: string): Buffer {
  return Buffer.from(s + '\0', 'utf16le')
}

export async function showSystemProperties(p: string): Promise<{ shown: true }> {
  const n = requireAbsolute(p)
  if (!(await pathExists(n))) throw new AppError('not-found', `Not found: ${n}`)

  const exec = ensureShellExecuteEx()
  const verb = wideZ('properties')
  const file = wideZ(n)
  const info: Record<string, unknown> = {
    cbSize: infoSize,
    fMask: SEE_MASK_INVOKEIDLIST,
    hwnd: null,
    lpVerb: verb,
    lpFile: file,
    lpParameters: null,
    lpDirectory: null,
    nShow: SW_SHOW,
    hInstApp: null,
    lpIDList: null,
    lpClass: null,
    hkeyClass: null,
    dwHotKey: 0,
    hIconOrMonitor: null,
    hProcess: null
  }

  const ok = exec(info)
  // Keep wide buffers alive across the native call (GC must not free mid-call).
  void verb
  void file
  if (!ok) {
    throw new AppError('io', `Could not open Windows Properties for: ${n}`)
  }
  return { shown: true }
}
