import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { AppError } from '@shared/result'
import type { RecycleBinItem, RecycleBinListResponse } from '@shared/schemas/recycle'
import { requireAbsolute, pathExists } from './list'
import { resolveRestoreTargets } from './recycleIndex'
import { logMain } from '../logging'

const execFileAsync = promisify(execFile)

const LIST_CAP = 5000
/** SHERB_NOCONFIRMATION | SHERB_NOSOUND — Windows may still show progress. */
const SHERB_NOCONFIRMATION = 0x00000001
const SHERB_NOSOUND = 0x00000004
const SHERB_EMPTY_FLAGS = SHERB_NOCONFIRMATION | SHERB_NOSOUND
const E_UNEXPECTED = 0x8000ffff
const HRESULT_CANCELLED = 0x800704c7
const ERROR_CANCELLED = 1223

/**
 * Classify SHEmptyRecycleBin HRESULT. Already-empty often returns S_OK or
 * E_UNEXPECTED; a 3-minute execFile kill is not used (large bins take longer).
 */
export function classifyEmptyRecycleHresult(code: number): 'ok' | 'cancelled' | 'failed' {
  const hr = code | 0
  if (hr === 0 || hr === 1) return 'ok'
  const u = hr >>> 0
  if (u === E_UNEXPECTED) return 'ok'
  if (u === HRESULT_CANCELLED || (u & 0xffff) === ERROR_CANCELLED) return 'cancelled'
  return 'failed'
}

/**
 * FolderItem.InvokeVerb('restore'|'delete') is a no-op in several Windows /
 * PowerShell COM hosts — the verb runs only via Verbs() → DoIt().
 * Match the accelerator-stripped display name (English + common locales).
 */
const PS_INVOKE_VERB = `
function Invoke-MfeBinVerb($item, [string[]]$names) {
  $verbs = @($item.Verbs())
  foreach ($v in $verbs) {
    try {
      $n = (($v.Name -replace '&','').Trim().ToLowerInvariant())
      foreach ($want in $names) {
        if ($n -eq $want -or $n.StartsWith($want + ' ')) { $v.DoIt(); return $true }
      }
    } catch {}
  }
  return $false
}
function Invoke-MfeBinStorePath([string]$rp, [string[]]$verbNames) {
  $rp = $rp.Trim()
  if (-not $rp) { return $false }
  $parent = [System.IO.Path]::GetDirectoryName($rp)
  $leaf = [System.IO.Path]::GetFileName($rp)
  if (-not $parent -or -not $leaf) { return $false }
  $shell = New-Object -ComObject Shell.Application
  $folder = $shell.NameSpace($parent)
  if (-not $folder) { return $false }
  $item = $folder.ParseName($leaf)
  if (-not $item) { return $false }
  if (Invoke-MfeBinVerb $item $verbNames) {
    Write-Output $rp
    return $true
  }
  return $false
}
`

async function runPowerShell(script: string, timeoutMs: number): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
  )
  if (stderr?.trim()) {
    logMain('warn', `recycle PS stderr: ${stderr.trim().slice(0, 400)}`)
  }
  return stdout ?? ''
}

function assertWin32(): void {
  if (process.platform !== 'win32') {
    throw new AppError('validation', 'Recycle Bin is only available on Windows')
  }
}

/**
 * List items in the Windows Recycle Bin (Shell.Application namespace 0xA).
 */
export async function listRecycleBin(): Promise<RecycleBinListResponse> {
  assertWin32()
  const outFile = path.join(os.tmpdir(), `mfe-rblist-${process.pid}-${Date.now()}.json`)
  const outLiteral = outFile.replace(/'/g, "''")
  const cap = LIST_CAP
  const ps = `
$ErrorActionPreference = 'Continue'
$shell = New-Object -ComObject Shell.Application
$rb = $shell.NameSpace(0xA)
if (-not $rb) { throw 'Recycle Bin namespace unavailable' }
$items = New-Object System.Collections.Generic.List[object]
$n = 0
$truncated = $false
foreach ($item in @($rb.Items())) {
  if ($n -ge ${cap}) { $truncated = $true; break }
  try {
    $deletedFrom = $item.ExtendedProperty('System.Recycle.DeletedFrom')
    if (-not $deletedFrom) { $deletedFrom = $rb.GetDetailsOf($item, 1) }
    $deletedFrom = [string]$deletedFrom
    $name = [string]$item.Name
    $original = if ($deletedFrom) { [System.IO.Path]::Combine($deletedFrom, $name) } else { $name }
    $dateMs = 0
    try {
      $d = $item.ExtendedProperty('System.Recycle.DateDeleted')
      if ($d) { $dateMs = [int64]([DateTime]::Parse([string]$d).ToUniversalTime().Subtract([datetime]'1970-01-01').TotalMilliseconds) }
    } catch {}
    $isDir = $false
    try { $isDir = [bool]$item.IsFolder } catch {}
    $size = 0
    try { $size = [int64]$item.Size } catch {}
    $items.Add([pscustomobject]@{
      name = $name
      originalPath = $original
      recyclePath = [string]$item.Path
      deletedFrom = $deletedFrom
      dateDeletedMs = $dateMs
      size = $size
      isDir = $isDir
    })
    $n++
  } catch {}
}
@{ items = $items; truncated = $truncated } | ConvertTo-Json -Compress -Depth 4 | Set-Content -LiteralPath '${outLiteral}' -Encoding utf8
`
  try {
    await runPowerShell(ps, 120_000)
    const raw = await fsp.readFile(outFile, 'utf8')
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as {
      items?: RecycleBinItem[] | RecycleBinItem
      truncated?: boolean
    }
    const list = parsed.items
    const items = !list ? [] : Array.isArray(list) ? list : [list]
    return {
      items: items.map((it) => ({
        name: String(it.name ?? ''),
        originalPath: String(it.originalPath ?? ''),
        recyclePath: String(it.recyclePath ?? ''),
        deletedFrom: String(it.deletedFrom ?? ''),
        dateDeletedMs: Number(it.dateDeletedMs) || 0,
        size: Number(it.size) || 0,
        isDir: Boolean(it.isDir)
      })).filter((it) => it.originalPath.length > 0),
      truncated: Boolean(parsed.truncated)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new AppError('io', `Could not list Recycle Bin: ${message}`)
  } finally {
    await fsp.unlink(outFile).catch(() => {})
  }
}

async function waitPathExists(filePath: string, attempts = 25): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await pathExists(filePath)) return true
    await new Promise((r) => setTimeout(r, 40 + i * 20))
  }
  return false
}

function normalizeWantedPath(p: string): string {
  try {
    return requireAbsolute(p)
  } catch {
    return p.trim()
  }
}

function recycleOpTimeoutMs(count: number): number {
  return Math.min(600_000, Math.max(45_000, count * 20_000))
}

async function invokeRecycleStorePaths(
  recyclePaths: readonly string[],
  verbNames: readonly string[],
  timeoutMs: number
): Promise<Set<string>> {
  if (recyclePaths.length === 0) return new Set()

  const listFile = path.join(os.tmpdir(), `mfe-rbverb-${process.pid}-${Date.now()}.txt`)
  await fsp.writeFile(listFile, recyclePaths.join('\n'), 'utf8')
  const listLiteral = listFile.replace(/'/g, "''")
  const verbLiteral = verbNames.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')
  const ps = `
$ErrorActionPreference = 'Continue'
${PS_INVOKE_VERB}
$names = @(${verbLiteral})
foreach ($line in @(Get-Content -LiteralPath '${listLiteral}' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
  [void](Invoke-MfeBinStorePath $line $names)
}
`
  try {
    const stdout = await runPowerShell(ps, timeoutMs)
    return new Set(
      stdout
        .split(/\r?\n/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    )
  } finally {
    await fsp.unlink(listFile).catch(() => {})
  }
}

async function resolveDeleteTargets(
  wanted: readonly string[]
): Promise<Awaited<ReturnType<typeof resolveRestoreTargets>>> {
  return resolveRestoreTargets(wanted)
}

/**
 * Restore selected Recycle Bin rows.
 * `paths` may be a shell `recyclePath` (in-app bin view) or the original full
 * path (Ctrl+Z after Del). Same original path can exist twice — recyclePath
 * picks one row; original path picks the newest Date deleted only.
 */
export async function restoreFromRecycleBin(
  paths: string[]
): Promise<{ restored: string[]; missing: string[] }> {
  assertWin32()
  const wanted = paths.map(normalizeWantedPath).filter(Boolean)
  if (wanted.length === 0) return { restored: [], missing: [] }

  const { targets, missing: resolveMissing } = await resolveRestoreTargets(wanted)
  const missing = [...resolveMissing]
  if (targets.length === 0) return { restored: [], missing: wanted }

  // Shell DoIt() can block on a hidden conflict dialog when the original path
  // already exists — fail fast instead of hanging until the app closes.
  const blocked: string[] = []
  const ready: typeof targets = []
  for (const t of targets) {
    if (t.originalPath && (await pathExists(t.originalPath))) {
      blocked.push(t.recyclePath)
      missing.push(t.recyclePath)
    } else {
      ready.push(t)
    }
  }
  if (ready.length === 0) {
    if (blocked.length > 0) {
      throw new AppError(
        'io',
        'Could not restore — a file already exists at the original location.',
        'Rename or remove the existing item, then try again.'
      )
    }
    return { restored: [], missing }
  }

  try {
    const reported = await invokeRecycleStorePaths(
      ready.map((t) => t.recyclePath),
      ['restore', 'wiederherstellen', 'restaurer', 'restablecer', 'ripristina'],
      recycleOpTimeoutMs(ready.length)
    )

    const restored: string[] = []
    for (const t of ready) {
      const rp = t.recyclePath.replace(/[/\\]+$/g, '').toLowerCase()
      const claimed = reported.has(rp)
      if (claimed || (await pathExists(t.originalPath))) {
        if (await waitPathExists(t.originalPath)) restored.push(t.originalPath)
        else missing.push(t.recyclePath)
      } else {
        missing.push(t.recyclePath)
      }
    }
    return { restored, missing }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new AppError('io', `Could not restore from Recycle Bin: ${message}`)
  }
}

/**
 * Permanently remove selected Recycle Bin rows (recyclePath or original path).
 */
export async function deleteFromRecycleBin(
  paths: string[]
): Promise<{ deleted: string[]; missing: string[] }> {
  assertWin32()
  const wanted = paths.map(normalizeWantedPath).filter(Boolean)
  if (wanted.length === 0) return { deleted: [], missing: [] }

  const { targets, missing: resolveMissing } = await resolveDeleteTargets(wanted)
  const missing = [...resolveMissing]
  if (targets.length === 0) return { deleted: [], missing: wanted }

  try {
    const reported = await invokeRecycleStorePaths(
      targets.map((t) => t.recyclePath),
      ['delete', 'löschen', 'supprimer', 'eliminar', 'elimina'],
      recycleOpTimeoutMs(targets.length)
    )

    const deleted: string[] = []
    for (const t of targets) {
      const rp = t.recyclePath.replace(/[/\\]+$/g, '').toLowerCase()
      if (reported.has(rp)) deleted.push(t.originalPath)
      else missing.push(t.recyclePath)
    }
    return { deleted, missing }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new AppError('io', `Could not delete from Recycle Bin: ${message}`)
  }
}

/**
 * Empty the Recycle Bin on every volume (Explorer’s SHEmptyRecycleBin).
 * Does not list items first — listing via COM races if files are still arriving
 * and times out on a large bin. Runs in a child process so main stays responsive.
 */
export async function emptyRecycleBin(): Promise<{ emptied: true }> {
  assertWin32()
  const flags = SHERB_EMPTY_FLAGS
  const ps = `
$ErrorActionPreference = 'Stop'
if (-not ([System.Management.Automation.PSTypeName]'MfeEmptyRecycleBin').Type) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MfeEmptyRecycleBin {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern int SHEmptyRecycleBin(IntPtr hwnd, string pszRootPath, uint dwFlags);
}
'@
}
$code = [MfeEmptyRecycleBin]::SHEmptyRecycleBin([IntPtr]::Zero, $null, ${flags})
Write-Output $code
`
  try {
    // timeout 0 = no kill. A large bin can take longer than the old 180s cap.
    const stdout = await runPowerShell(ps, 0)
    const line = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => /^-?\d+$/.test(s))
    const code = line != null ? Number(line) : 0
    const kind = classifyEmptyRecycleHresult(code)
    if (kind === 'ok') return { emptied: true }
    if (kind === 'cancelled') {
      throw new AppError('io', 'Empty Recycle Bin was cancelled')
    }
    throw new AppError('io', `Could not empty Recycle Bin (HRESULT 0x${(code >>> 0).toString(16)})`)
  } catch (e) {
    if (e instanceof AppError) throw e
    const message = e instanceof Error ? e.message : String(e)
    try {
      await runPowerShell('Clear-RecycleBin -Force -ErrorAction Stop', 0)
      return { emptied: true }
    } catch {
      throw new AppError('io', `Could not empty Recycle Bin: ${message}`)
    }
  }
}
