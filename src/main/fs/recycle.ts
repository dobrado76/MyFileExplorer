import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { AppError } from '@shared/result'
import type { RecycleBinItem, RecycleBinListResponse } from '@shared/schemas/recycle'
import { requireAbsolute, pathExists } from './list'
import { logMain } from '../logging'

const execFileAsync = promisify(execFile)

const LIST_CAP = 5000

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

/**
 * Restore items from the Windows Recycle Bin by original full path.
 * Matches Shell.Application namespace 0xA (Recycle Bin) via PowerShell COM.
 */
export async function restoreFromRecycleBin(
  originalPaths: string[]
): Promise<{ restored: string[]; missing: string[] }> {
  assertWin32()
  const wanted = originalPaths.map((p) => requireAbsolute(p))
  if (wanted.length === 0) return { restored: [], missing: [] }

  const listFile = path.join(os.tmpdir(), `mfe-restore-${process.pid}-${Date.now()}.txt`)
  await fsp.writeFile(listFile, wanted.join('\n'), 'utf8')

  const listLiteral = listFile.replace(/'/g, "''")
  const ps = `
$ErrorActionPreference = 'Continue'
$wanted = @(Get-Content -LiteralPath '${listLiteral}' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
$shell = New-Object -ComObject Shell.Application
$rb = $shell.NameSpace(0xA)
if (-not $rb) { throw 'Recycle Bin namespace unavailable' }
$restored = New-Object System.Collections.Generic.List[string]
foreach ($item in @($rb.Items())) {
  try {
    $loc = $item.ExtendedProperty('System.Recycle.DeletedFrom')
    if (-not $loc) { $loc = $rb.GetDetailsOf($item, 1) }
    if (-not $loc) { continue }
    $full = [System.IO.Path]::Combine([string]$loc, [string]$item.Name)
    $key = $full.ToLowerInvariant()
    if ($wanted -contains $key) {
      $item.InvokeVerb('restore')
      [void]$restored.Add($full)
    }
  } catch {}
}
$restored | ForEach-Object { $_ }
`

  try {
    const stdout = await runPowerShell(ps, 90_000)
    const reported = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)

    const restored: string[] = []
    const missing: string[] = []
    for (const original of wanted) {
      const hit = reported.find((r) => r.toLowerCase() === original.toLowerCase())
      if (hit && (await pathExists(original))) {
        restored.push(original)
      } else if (await pathExists(original)) {
        restored.push(original)
      } else {
        missing.push(original)
      }
    }
    return { restored, missing }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new AppError('io', `Could not restore from Recycle Bin: ${message}`)
  } finally {
    await fsp.unlink(listFile).catch(() => {})
  }
}

/**
 * Permanently remove selected items from the Recycle Bin (by original path).
 */
export async function deleteFromRecycleBin(
  originalPaths: string[]
): Promise<{ deleted: string[]; missing: string[] }> {
  assertWin32()
  const wanted = originalPaths.map((p) => requireAbsolute(p))
  if (wanted.length === 0) return { deleted: [], missing: [] }

  const listFile = path.join(os.tmpdir(), `mfe-rbdel-${process.pid}-${Date.now()}.txt`)
  await fsp.writeFile(listFile, wanted.join('\n'), 'utf8')
  const listLiteral = listFile.replace(/'/g, "''")
  const ps = `
$ErrorActionPreference = 'Continue'
$wanted = @(Get-Content -LiteralPath '${listLiteral}' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
$shell = New-Object -ComObject Shell.Application
$rb = $shell.NameSpace(0xA)
if (-not $rb) { throw 'Recycle Bin namespace unavailable' }
$deleted = New-Object System.Collections.Generic.List[string]
foreach ($item in @($rb.Items())) {
  try {
    $loc = $item.ExtendedProperty('System.Recycle.DeletedFrom')
    if (-not $loc) { $loc = $rb.GetDetailsOf($item, 1) }
    if (-not $loc) { continue }
    $full = [System.IO.Path]::Combine([string]$loc, [string]$item.Name)
    $key = $full.ToLowerInvariant()
    if ($wanted -contains $key) {
      $item.InvokeVerb('delete')
      [void]$deleted.Add($full)
    }
  } catch {}
}
$deleted | ForEach-Object { $_ }
`
  try {
    const stdout = await runPowerShell(ps, 90_000)
    const reported = new Set(
      stdout
        .split(/\r?\n/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    )
    const deleted: string[] = []
    const missing: string[] = []
    for (const original of wanted) {
      if (reported.has(original.toLowerCase())) deleted.push(original)
      else missing.push(original)
    }
    return { deleted, missing }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new AppError('io', `Could not delete from Recycle Bin: ${message}`)
  } finally {
    await fsp.unlink(listFile).catch(() => {})
  }
}

/** Empty the entire Recycle Bin (all volumes). */
export async function emptyRecycleBin(): Promise<{ emptied: true }> {
  assertWin32()
  const ps = `
$ErrorActionPreference = 'Stop'
try {
  Clear-RecycleBin -Force -ErrorAction Stop
} catch {
  # Already empty or cmdlet unavailable — try COM delete-all
  $shell = New-Object -ComObject Shell.Application
  $rb = $shell.NameSpace(0xA)
  if ($rb) {
    foreach ($item in @($rb.Items())) {
      try { $item.InvokeVerb('delete') } catch {}
    }
  }
}
`
  try {
    await runPowerShell(ps, 180_000)
    return { emptied: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new AppError('io', `Could not empty Recycle Bin: ${message}`)
  }
}
