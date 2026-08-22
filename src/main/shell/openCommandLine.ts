/**
 * Open a console in a folder (Settings → Behavior: cmd or PowerShell).
 * Uses ShellExecuteW so a real visible window appears (CreateProcess + windowsHide
 * hides consoles). Click → current user (`open`). Shift+click → UAC (`runas`).
 */
import fsp from 'node:fs/promises'
import koffi from 'koffi'
import { requireAbsolute } from '../fs/list'
import { AppError } from '@shared/result'
import { logMain } from '../logging'
import { settingsStore } from '../settings/store'
import type { Settings } from '@shared/schemas/settings'

const SW_SHOWNORMAL = 1
/** ShellExecute success threshold — return values ≤ 32 are errors. */
const SE_ERR_THRESHOLD = 32

type ShellExecuteFn = (
  hwnd: null,
  operation: string,
  file: string,
  parameters: string | null,
  directory: string | null,
  showCmd: number
) => number | bigint

let shellExecuteW: ShellExecuteFn | null | undefined

function ensureShellExecute(): ShellExecuteFn | null {
  if (shellExecuteW !== undefined) return shellExecuteW
  if (process.platform !== 'win32') {
    shellExecuteW = null
    return null
  }
  try {
    const shell32 = koffi.load('shell32.dll')
    shellExecuteW = shell32.func(
      'intptr __stdcall ShellExecuteW(void *hwnd, str16 lpOperation, str16 lpFile, str16 lpParameters, str16 lpDirectory, int32 nShowCmd)'
    ) as ShellExecuteFn
  } catch (e) {
    logMain(
      'warn',
      `shell: ShellExecuteW load failed: ${e instanceof Error ? e.message : String(e)}`
    )
    shellExecuteW = null
  }
  return shellExecuteW
}

function shellExecuteOk(code: number | bigint): boolean {
  const n = typeof code === 'bigint' ? Number(code) : code
  return Number.isFinite(n) && n > SE_ERR_THRESHOLD
}

function shellExecute(
  operation: string,
  file: string,
  parameters: string | null,
  directory: string | null
): boolean {
  const fn = ensureShellExecute()
  if (!fn) return false
  try {
    const code = fn(null, operation, file, parameters, directory, SW_SHOWNORMAL)
    return shellExecuteOk(code)
  } catch (e) {
    logMain(
      'warn',
      `shell: ShellExecuteW(${operation}, ${file}) failed: ${
        e instanceof Error ? e.message : String(e)
      }`
    )
    return false
  }
}

/** ShellExecute “open” for a documented Windows tool (.msc, control.exe, ms-settings:). */
export function shellExecuteOpen(file: string, parameters?: string | null): boolean {
  return shellExecute('open', file, parameters ?? null, null)
}

export type OpenCommandLineOptions = {
  /** Launch elevated (UAC) — Explorer Shift+“Open … as administrator”. */
  elevated?: boolean
}

function commandLineShell(): Settings['commandLineShell'] {
  try {
    return settingsStore().get().commandLineShell === 'powershell' ? 'powershell' : 'cmd'
  } catch {
    return 'cmd'
  }
}

/**
 * Open a detached console in `dirPath`.
 * Shell from settings (`cmd` default). Click is never elevated; `elevated` is Shift+click only.
 */
export async function openCommandLineHere(
  dirPath: string,
  opts?: OpenCommandLineOptions
): Promise<{ opened: true }> {
  if (process.platform !== 'win32') {
    throw new AppError('io', 'Open command line is only available on Windows')
  }
  const n = requireAbsolute(dirPath)
  let isDir: boolean
  try {
    isDir = (await fsp.stat(n)).isDirectory()
  } catch {
    throw new AppError('not-found', `Not found: ${n}`)
  }
  if (!isDir) throw new AppError('validation', 'Open command line requires a folder')

  const elevated = opts?.elevated === true
  const verb = elevated ? 'runas' : 'open'
  const isUnc = n.startsWith('\\\\')
  // UNC cannot be ShellExecute lpDirectory.
  const workDir = isUnc ? null : n
  const escaped = n.replace(/"/g, '')
  const shell = commandLineShell()
  const label = shell === 'powershell' ? 'PowerShell' : 'Command Prompt'

  if (shell === 'powershell') {
    const psLiteral = n.replace(/'/g, "''")
    const psParams = `-NoExit -Command Set-Location -LiteralPath '${psLiteral}'`
    if (shellExecute(verb, 'powershell.exe', psParams, workDir)) {
      return { opened: true }
    }
    if (!elevated) {
      const startArgs = `/c start "" powershell.exe ${psParams}`
      if (shellExecute('open', 'cmd.exe', startArgs, workDir)) {
        return { opened: true }
      }
    }
  } else {
    const cmdParams = isUnc ? `/k pushd "${escaped}"` : `/k cd /d "${escaped}"`
    if (shellExecute(verb, 'cmd.exe', cmdParams, workDir)) {
      return { opened: true }
    }
    if (!elevated) {
      const startArgs = isUnc
        ? `/c start "" cmd.exe /k pushd "${escaped}"`
        : `/c start "" cmd.exe /k cd /d "${escaped}"`
      if (shellExecute('open', 'cmd.exe', startArgs, workDir)) {
        return { opened: true }
      }
    }
  }

  throw new AppError(
    'io',
    elevated
      ? `Could not open an elevated ${label} (UAC cancelled or ShellExecute failed)`
      : `Could not open ${label}`
  )
}
