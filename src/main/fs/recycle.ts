import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { AppError } from '@shared/result'
import type { RecycleBinItem, RecycleBinListResponse } from '@shared/schemas/recycle'
import { requireAbsolute, pathExists } from './list'
import { recycleDataToMetaPath, resolveRestoreTargets } from './recycleIndex'
import type { RecyclePickItem } from './recycleMatch'
import { getWinAttributeFlags, setWinAttributeFlags } from './winAttrs'
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
 *
 * Prefer Recycle Bin namespace 0xA: ParseName on `$Recycle.Bin\SID` often has no
 * working Restore verb (DoIt appears to succeed but the file stays in the bin).
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
function Normalize-MfeBinPath([string]$p) {
  if (-not $p) { return '' }
  return (($p.Trim() -replace '/','\\').TrimEnd('\\'))
}
function Invoke-MfeBinNamespaceVerbs([string[]]$wantedPaths, [string[]]$verbNames) {
  $want = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($w in $wantedPaths) {
    $n = Normalize-MfeBinPath $w
    if ($n) { [void]$want.Add($n) }
  }
  if ($want.Count -eq 0) { return }
  $shell = New-Object -ComObject Shell.Application
  $rb = $shell.NameSpace(0xA)
  if (-not $rb) { return }
  foreach ($item in @($rb.Items())) {
    try {
      $rp = Normalize-MfeBinPath ([string]$item.Path)
      if (-not $rp -or -not $want.Contains($rp)) { continue }
      if (Invoke-MfeBinVerb $item $verbNames) { Write-Output $rp }
    } catch {}
  }
}
function Invoke-MfeBinStorePath([string]$rp, [string[]]$verbNames) {
  $rp = Normalize-MfeBinPath $rp
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

const RESTORE_VERBS = ['restore', 'wiederherstellen', 'restaurer', 'restablecer', 'ripristina'] as const
const DELETE_VERBS = ['delete', 'löschen', 'supprimer', 'eliminar', 'elimina'] as const

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

function pathKey(p: string): string {
  return p.replace(/[/\\]+$/g, '').toLowerCase()
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
      items: items
        .map((it) => ({
          name: String(it.name ?? ''),
          originalPath: String(it.originalPath ?? ''),
          recyclePath: String(it.recyclePath ?? ''),
          deletedFrom: String(it.deletedFrom ?? ''),
          dateDeletedMs: Number(it.dateDeletedMs) || 0,
          size: Number(it.size) || 0,
          isDir: Boolean(it.isDir)
        }))
        .filter((it) => it.originalPath.length > 0),
      truncated: Boolean(parsed.truncated)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new AppError('io', `Could not list Recycle Bin: ${message}`)
  } finally {
    await fsp.unlink(outFile).catch(() => {})
  }
}

async function waitPathExists(filePath: string, attempts = 40): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await pathExists(filePath)) return true
    await new Promise((r) => setTimeout(r, 50 + i * 25))
  }
  return false
}

async function waitPathGone(filePath: string, attempts = 40): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (!(await pathExists(filePath))) return true
    await new Promise((r) => setTimeout(r, 50 + i * 25))
  }
  return !(await pathExists(filePath))
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

function parseReportedPaths(stdout: string): Set<string> {
  return new Set(
    stdout
      .split(/\r?\n/)
      .map((s) => pathKey(s.trim()))
      .filter(Boolean)
  )
}

/** Primary: Recycle Bin namespace 0xA (real Restore/Delete verbs). */
async function invokeRecycleNamespaceVerbs(
  recyclePaths: readonly string[],
  verbNames: readonly string[],
  timeoutMs: number
): Promise<Set<string>> {
  if (recyclePaths.length === 0) return new Set()

  const listFile = path.join(os.tmpdir(), `mfe-rbns-${process.pid}-${Date.now()}.txt`)
  await fsp.writeFile(listFile, recyclePaths.join('\n'), 'utf8')
  const listLiteral = listFile.replace(/'/g, "''")
  const verbLiteral = verbNames.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')
  const ps = `
$ErrorActionPreference = 'Continue'
${PS_INVOKE_VERB}
$names = @(${verbLiteral})
$wanted = @(Get-Content -LiteralPath '${listLiteral}' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
Invoke-MfeBinNamespaceVerbs $wanted $names
`
  try {
    return parseReportedPaths(await runPowerShell(ps, timeoutMs))
  } finally {
    await fsp.unlink(listFile).catch(() => {})
  }
}

/** Fallback COM: ParseName on the physical `$Recycle.Bin\\SID` folder. */
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
    return parseReportedPaths(await runPowerShell(ps, timeoutMs))
  } finally {
    await fsp.unlink(listFile).catch(() => {})
  }
}

function clearRecycleAttrs(absPath: string): void {
  try {
    const flags = getWinAttributeFlags(absPath)
    if (!flags) return
    if (!flags.hidden && !flags.system && !flags.readOnly) return
    setWinAttributeFlags(absPath, {
      ...flags,
      hidden: false,
      system: false,
      readOnly: false
    })
  } catch {
    /* best-effort */
  }
}

/**
 * Direct restore: move `$R…` back to the original path and delete `$I…`.
 * Used when Shell Restore verbs claim success but leave the file in the bin
 * (or never expose a working verb via ParseName on the SID folder).
 */
export async function restoreViaFilesystem(t: RecyclePickItem): Promise<boolean> {
  if (!t.recyclePath || !t.originalPath) return false
  if (!(await pathExists(t.recyclePath))) return false
  if (await pathExists(t.originalPath)) return false

  const parent = path.win32.dirname(t.originalPath)
  try {
    await fsp.mkdir(parent, { recursive: true })
  } catch {
    /* parent may already exist */
  }

  const metaPath = recycleDataToMetaPath(t.recyclePath)
  clearRecycleAttrs(t.recyclePath)
  if (metaPath) clearRecycleAttrs(metaPath)

  try {
    await fsp.rename(t.recyclePath, t.originalPath)
  } catch (e) {
    logMain(
      'warn',
      `recycle filesystem restore rename failed: ${e instanceof Error ? e.message : String(e)}`
    )
    return false
  }

  if (metaPath) {
    await fsp.unlink(metaPath).catch(() => {})
  }

  return waitPathExists(t.originalPath)
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
 *
 * Success requires the original path to exist on disk afterward — never trust
 * Shell DoIt() alone (it can no-op while still returning).
 */
export async function restoreFromRecycleBin(
  paths: string[]
): Promise<{ restored: string[]; missing: string[] }> {
  assertWin32()
  const wanted = paths.map(normalizeWantedPath).filter(Boolean)
  if (wanted.length === 0) return { restored: [], missing: [] }

  const { targets, missing: resolveMissing } = await resolveRestoreTargets(wanted)
  const missing = [...resolveMissing]
  if (targets.length === 0) {
    throw new AppError(
      'not-found',
      'Could not find that item in the Recycle Bin',
      'Refresh the Recycle Bin view, then try Restore again before Emptying.'
    )
  }

  // Shell DoIt() can block on a hidden conflict dialog when the original path
  // already exists — fail fast instead of hanging until the app closes.
  const blocked: string[] = []
  const ready: RecyclePickItem[] = []
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
        'Rename or remove the existing item, then try again. Do not Empty the Recycle Bin until Restore succeeds.'
      )
    }
    return { restored: [], missing }
  }

  const timeout = recycleOpTimeoutMs(ready.length)
  const recyclePaths = ready.map((t) => t.recyclePath)

  try {
    // 1) Namespace 0xA — real Restore verbs
    await invokeRecycleNamespaceVerbs(recyclePaths, RESTORE_VERBS, timeout)

    const restored: string[] = []
    const stillPending: RecyclePickItem[] = []

    for (const t of ready) {
      if (await waitPathExists(t.originalPath, 12)) {
        restored.push(t.originalPath)
        continue
      }
      stillPending.push(t)
    }

    // 2) SID-folder ParseName COM (legacy fallback)
    if (stillPending.length > 0) {
      await invokeRecycleStorePaths(
        stillPending.map((t) => t.recyclePath),
        RESTORE_VERBS,
        recycleOpTimeoutMs(stillPending.length)
      )
      const afterCom: RecyclePickItem[] = []
      for (const t of stillPending) {
        if (await waitPathExists(t.originalPath, 12)) restored.push(t.originalPath)
        else afterCom.push(t)
      }
      stillPending.length = 0
      stillPending.push(...afterCom)
    }

    // 3) Direct $R → original move (authoritative when Shell verbs no-op)
    for (const t of stillPending) {
      if (await restoreViaFilesystem(t)) {
        restored.push(t.originalPath)
      } else {
        missing.push(t.recyclePath)
      }
    }

    if (restored.length === 0) {
      throw new AppError(
        'io',
        'Could not restore from Recycle Bin',
        'The item should still be in the Recycle Bin. Do not Empty until Restore succeeds.'
      )
    }

    return { restored, missing }
  } catch (e) {
    if (e instanceof AppError) throw e
    const message = e instanceof Error ? e.message : String(e)
    throw new AppError(
      'io',
      `Could not restore from Recycle Bin: ${message}`,
      'The item should still be in the Recycle Bin. Do not Empty until Restore succeeds.'
    )
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

  const timeout = recycleOpTimeoutMs(targets.length)
  const recyclePaths = targets.map((t) => t.recyclePath)

  try {
    await invokeRecycleNamespaceVerbs(recyclePaths, DELETE_VERBS, timeout)

    const deleted: string[] = []
    const stillPending: RecyclePickItem[] = []
    for (const t of targets) {
      if (await waitPathGone(t.recyclePath, 12)) deleted.push(t.originalPath)
      else stillPending.push(t)
    }

    if (stillPending.length > 0) {
      await invokeRecycleStorePaths(
        stillPending.map((t) => t.recyclePath),
        DELETE_VERBS,
        recycleOpTimeoutMs(stillPending.length)
      )
      for (const t of stillPending) {
        if (await waitPathGone(t.recyclePath, 12)) deleted.push(t.originalPath)
        else {
          // Last resort: unlink $R + $I directly
          const meta = recycleDataToMetaPath(t.recyclePath)
          clearRecycleAttrs(t.recyclePath)
          if (meta) clearRecycleAttrs(meta)
          try {
            await fsp.rm(t.recyclePath, { recursive: true, force: true })
            if (meta) await fsp.unlink(meta).catch(() => {})
            if (await waitPathGone(t.recyclePath, 8)) deleted.push(t.originalPath)
            else missing.push(t.recyclePath)
          } catch {
            missing.push(t.recyclePath)
          }
        }
      }
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
