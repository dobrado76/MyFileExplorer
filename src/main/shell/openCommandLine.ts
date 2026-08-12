/**
 * Open an external console (Windows Terminal / PowerShell / cmd) in a folder.
 * Uses ShellExecuteW so a real visible window appears (CreateProcess + windowsHide
 * hides consoles; WindowsApps wt.exe stubs often fail under CreateProcess).
 * Shift+click / elevated → ShellExecute "runas" (UAC), Explorer-style.
 */
import { spawnSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import koffi from 'koffi'
import { requireAbsolute } from '../fs/list'
import { AppError } from '@shared/result'
import { logMain } from '../logging'

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

function wtAvailable(): boolean {
  const whereWt = spawnSync('where.exe', ['wt.exe'], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 3_000
  })
  return whereWt.status === 0 && !!(whereWt.stdout ?? '').trim()
}

function quoteCmdArg(s: string): string {
  if (!/[ \t"]/u.test(s)) return s
  return `"${s.replace(/"/g, '\\"')}"`
}

export type OpenCommandLineOptions = {
  /** Launch elevated (UAC) — Explorer Shift+“Open … as administrator”. */
  elevated?: boolean
}

/**
 * Open a detached console in `dirPath`.
 * Prefers Windows Terminal, then PowerShell, then cmd.
 */
export async function openCommandLineHere(
  dirPath: string,
  opts?: OpenCommandLineOptions
): Promise<{ opened: true }> {
  if (process.platform !== 'win32') {
    throw new AppError('io', 'Open command line is only available on Windows')
  }
  const n = requireAbsolute(dirPath)
  let isDir = false
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
  const psLiteral = n.replace(/'/g, "''")
  const escaped = n.replace(/"/g, '')

  if (wtAvailable()) {
    // -d sets starting directory (works for drive letters and UNC).
    if (shellExecute(verb, 'wt.exe', `-d ${quoteCmdArg(n)}`, workDir)) {
      return { opened: true }
    }
  }

  const psParams = `-NoExit -Command Set-Location -LiteralPath '${psLiteral}'`
  if (shellExecute(verb, 'powershell.exe', psParams, workDir)) {
    return { opened: true }
  }

  const cmdParams = isUnc ? `/k pushd "${escaped}"` : `/k cd /d "${escaped}"`
  if (shellExecute(verb, 'cmd.exe', cmdParams, workDir)) {
    return { opened: true }
  }

  // Last resort: cmd start (always creates a visible console for non-elevated).
  if (!elevated) {
    const startArgs = wtAvailable()
      ? `/c start "" wt.exe -d ${quoteCmdArg(n)}`
      : isUnc
        ? `/c start "" cmd.exe /k pushd "${escaped}"`
        : `/c start "" cmd.exe /k cd /d "${escaped}"`
    if (shellExecute('open', 'cmd.exe', startArgs, workDir)) {
      return { opened: true }
    }
  }

  throw new AppError(
    'io',
    elevated
      ? 'Could not open an elevated command line (UAC cancelled or ShellExecute failed)'
      : 'Could not open command line'
  )
}
