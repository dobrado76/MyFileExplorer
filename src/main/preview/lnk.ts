import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { PreviewField } from '@shared/schemas/preview'

const execFileAsync = promisify(execFile)

export type LnkDetails = {
  targetPath: string
  arguments: string
  workingDirectory: string
  description: string
  iconLocation: string
  hotkey: string
  windowStyle: number
  /** Resolved existence of TargetPath when it looks like a filesystem path. */
  targetExists: boolean | null
  targetKind: 'file' | 'dir' | 'url' | 'unknown' | null
}

function psSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

function windowStyleLabel(style: number): string {
  switch (style) {
    case 1:
      return 'Normal'
    case 3:
      return 'Maximized'
    case 7:
      return 'Minimized'
    default:
      return style ? `Style ${style}` : ''
  }
}

function looksLikeUrl(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target)
}

async function classifyTarget(target: string): Promise<{
  exists: boolean | null
  kind: LnkDetails['targetKind']
}> {
  if (!target.trim()) return { exists: null, kind: null }
  if (looksLikeUrl(target) && !/^[a-zA-Z]:[\\/]/.test(target)) {
    return { exists: null, kind: 'url' }
  }
  try {
    const st = await fsp.stat(target)
    return { exists: true, kind: st.isDirectory() ? 'dir' : 'file' }
  } catch {
    return { exists: false, kind: 'unknown' }
  }
}

/**
 * Read a Windows `.lnk` via WScript.Shell (same fields Explorer Properties shows).
 */
export async function readLnkDetails(lnkPath: string): Promise<LnkDetails> {
  if (process.platform !== 'win32') {
    throw new Error('Shortcut preview is only available on Windows')
  }
  // Newlines — do not join hashtable lines with `;` (that yields `@{; TargetPath=…`).
  const cmd = [
    '$ErrorActionPreference = "Stop"',
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psSingleQuote(lnkPath)})`,
    '[ordered]@{',
    '  TargetPath = [string]$s.TargetPath',
    '  Arguments = [string]$s.Arguments',
    '  WorkingDirectory = [string]$s.WorkingDirectory',
    '  Description = [string]$s.Description',
    '  IconLocation = [string]$s.IconLocation',
    '  Hotkey = [string]$s.Hotkey',
    '  WindowStyle = [int]$s.WindowStyle',
    '} | ConvertTo-Json -Compress'
  ].join('\n')

  let stdout: string
  try {
    const res = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', cmd],
      { windowsHide: true, timeout: 10_000, maxBuffer: 256 * 1024 }
    )
    stdout = res.stdout
  } catch (e) {
    const err = e as { stderr?: string; message?: string }
    const detail = (err.stderr ?? err.message ?? '').trim()
    throw new Error(
      detail.includes('CreateShortcut') || detail.includes('WScript')
        ? 'Could not open this shortcut'
        : 'Could not read shortcut properties',
      { cause: e }
    )
  }
  const raw = stdout.trim()
  if (!raw) throw new Error('Could not read shortcut properties')
  let data: {
    TargetPath?: string
    Arguments?: string
    WorkingDirectory?: string
    Description?: string
    IconLocation?: string
    Hotkey?: string
    WindowStyle?: number
  }
  try {
    data = JSON.parse(raw) as typeof data
  } catch {
    throw new Error('Could not read shortcut properties')
  }
  const targetPath = (data.TargetPath ?? '').trim()
  const classified = await classifyTarget(targetPath)
  return {
    targetPath,
    arguments: (data.Arguments ?? '').trim(),
    workingDirectory: (data.WorkingDirectory ?? '').trim(),
    description: (data.Description ?? '').trim(),
    iconLocation: (data.IconLocation ?? '').trim(),
    hotkey: (data.Hotkey ?? '').trim(),
    windowStyle: typeof data.WindowStyle === 'number' ? data.WindowStyle : 1,
    targetExists: classified.exists,
    targetKind: classified.kind
  }
}

export function lnkDetailsToFields(details: LnkDetails): PreviewField[] {
  const fields: PreviewField[] = []
  const push = (id: string, label: string, value: string, mono = false): void => {
    if (!value) return
    fields.push({
      id,
      label,
      value,
      group: 'shortcut',
      mono,
      copyable: true
    })
  }

  push('lnk.target', 'Target', details.targetPath, true)
  if (details.targetKind === 'url') {
    fields.push({
      id: 'lnk.targetKind',
      label: 'Target type',
      value: 'URL / protocol',
      group: 'shortcut'
    })
  } else if (details.targetKind === 'dir') {
    fields.push({
      id: 'lnk.targetKind',
      label: 'Target type',
      value: details.targetExists === false ? 'Folder (missing)' : 'Folder',
      group: 'shortcut'
    })
  } else if (details.targetKind === 'file') {
    fields.push({
      id: 'lnk.targetKind',
      label: 'Target type',
      value: details.targetExists === false ? 'File (missing)' : 'File',
      group: 'shortcut'
    })
  } else if (details.targetPath && details.targetExists === false) {
    fields.push({
      id: 'lnk.targetKind',
      label: 'Target type',
      value: 'Missing',
      group: 'shortcut'
    })
  }

  push('lnk.args', 'Arguments', details.arguments, true)
  push('lnk.cwd', 'Start in', details.workingDirectory, true)
  push('lnk.comment', 'Comment', details.description)
  const icon = details.iconLocation.replace(/,0$/, '').trim()
  push('lnk.icon', 'Icon location', icon, true)
  push('lnk.hotkey', 'Shortcut key', details.hotkey)
  const ws = windowStyleLabel(details.windowStyle)
  if (ws && details.windowStyle !== 1) {
    fields.push({ id: 'lnk.window', label: 'Run', value: ws, group: 'shortcut' })
  }

  if (details.targetPath && !looksLikeUrl(details.targetPath)) {
    fields.push({
      id: 'lnk.targetName',
      label: 'Target name',
      value: path.basename(details.targetPath),
      group: 'shortcut',
      copyable: true
    })
  }

  return fields
}

export { windowStyleLabel, psSingleQuote }
