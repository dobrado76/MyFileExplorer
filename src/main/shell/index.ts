import { spawn } from 'node:child_process'
import { shell, clipboard } from 'electron'
import { requireAbsolute, pathExists } from '../fs/list'
import { expandWindowsEnvPath } from '../paths/expandEnv'
import { AppError } from '@shared/result'
import { isWindowsBatchFile, quoteWindowsCmdArg } from '@shared/shellExec'
import { winClipboardWriteFiles, winClipboardReadFiles, buildCfHdrop, parseCfHdrop } from './clipboardWin32'

const MAX_EXEC_ARGS = 256
const MAX_ARG_LEN = 32767

export async function openPath(p: string): Promise<{ opened: boolean; message?: string }> {
  const n = requireAbsolute(p)
  if (n.toLowerCase().startsWith('mfe-remote://')) {
    const { remoteStat } = await import('../remote/sessionPool')
    const { ensureRemoteLocalFile } = await import('../remote/scratch')
    const st = await remoteStat(n)
    if (!st) return { opened: false, message: 'Remote file not found' }
    if (st.kind === 'dir') {
      return { opened: false, message: 'Open folders by navigating into them' }
    }
    try {
      const { localPath } = await ensureRemoteLocalFile(n)
      const message = await shell.openPath(localPath)
      return message ? { opened: false, message } : { opened: true }
    } catch (e) {
      return {
        opened: false,
        message: e instanceof Error ? e.message : 'Could not download remote file'
      }
    }
  }
  const message = await shell.openPath(n)
  return message ? { opened: false, message } : { opened: true }
}

/**
 * Launch a user-configured external program with argv.
 * `.exe` / scripts spawn directly; `.bat` / `.cmd` go through `cmd.exe /d /s /c`
 * (Node cannot spawn batch files on Windows — that yields EINVAL).
 * `executable` may contain `%ENV%` segments.
 */
export async function execExternal(
  executable: string,
  args: string[]
): Promise<{ launched: true }> {
  const raw = executable.trim()
  if (!raw) throw new AppError('validation', 'Executable path is empty')
  if (args.length > MAX_EXEC_ARGS) {
    throw new AppError('validation', `Too many arguments (max ${MAX_EXEC_ARGS})`)
  }
  for (const a of args) {
    if (typeof a !== 'string' || a.length > MAX_ARG_LEN) {
      throw new AppError('validation', 'Argument is missing or too long')
    }
  }
  const expanded = expandWindowsEnvPath(raw)
  let exe: string
  try {
    exe = requireAbsolute(expanded)
  } catch {
    throw new AppError(
      'validation',
      `Executable must be an absolute path after expansion: ${expanded}`
    )
  }
  if (!(await pathExists(exe))) {
    throw new AppError('not-found', `Program not found: ${exe}`, 'Browse to the .exe in Settings.')
  }
  try {
    const child =
      process.platform === 'win32' && isWindowsBatchFile(exe)
        ? spawn(
            process.env.ComSpec || 'cmd.exe',
            ['/d', '/s', '/c', [exe, ...args].map(quoteWindowsCmdArg).join(' ')],
            {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
              windowsVerbatimArguments: true
            }
          )
        : spawn(exe, args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          })
    child.unref()
    return { launched: true }
  } catch (e) {
    throw new AppError(
      'io',
      e instanceof Error ? e.message : 'Could not launch program'
    )
  }
}

/** Open the Windows Recycle Bin in system Explorer (virtual shell folder). */
export function openRecycleBin(): { opened: boolean; message?: string } {
  if (process.platform !== 'win32') {
    return { opened: false, message: 'Recycle Bin is only available on Windows' }
  }
  try {
    // explorer often exits non-zero even when it opens — fire-and-forget.
    spawn('explorer.exe', ['shell:RecycleBinFolder'], {
      detached: true,
      stdio: 'ignore'
    }).unref()
    return { opened: true }
  } catch (e) {
    return {
      opened: false,
      message: e instanceof Error ? e.message : 'Could not open Recycle Bin'
    }
  }
}

export async function showItemInFolder(p: string): Promise<{ shown: true }> {
  const n = requireAbsolute(p)
  if (!(await pathExists(n))) throw new AppError('not-found', `Not found: ${n}`)
  shell.showItemInFolder(n)
  return { shown: true }
}

export function clipboardWriteFiles(
  paths: string[],
  effect: 'copy' | 'move' = 'copy'
): { written: boolean } {
  const normalized = paths.map(requireAbsolute)
  if (process.platform === 'win32') {
    try {
      if (winClipboardWriteFiles(normalized, effect)) return { written: true }
    } catch {
      /* fall through to Electron buffer (in-app read may still work) */
    }
    try {
      clipboard.writeBuffer('CF_HDROP', buildCfHdrop(normalized))
      clipboard.writeText(normalized.join('\r\n'))
      return { written: true }
    } catch {
      return { written: false }
    }
  }
  clipboard.writeText(normalized.join('\r\n'))
  return { written: false }
}

export function clipboardReadFiles(): { paths: string[]; effect: 'copy' | 'move' } {
  if (process.platform === 'win32') {
    try {
      const native = winClipboardReadFiles()
      if (native.paths.length > 0) return native
    } catch {
      /* fall through */
    }
    try {
      const buf = clipboard.readBuffer('CF_HDROP')
      if (buf && buf.length > 0) {
        return { paths: parseCfHdrop(buf), effect: 'copy' }
      }
    } catch {
      /* fall through to empty */
    }
  }
  return { paths: [], effect: 'copy' }
}

export { startOsFileDrag } from './startDrag'
export { showSystemProperties } from './showProperties'
export { openCommandLineHere } from './openCommandLine'
export { openWindowsTool } from './windowsTools'
