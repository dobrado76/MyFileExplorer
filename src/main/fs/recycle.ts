import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { AppError } from '@shared/result'
import type { RecycleBinItem, RecycleBinListResponse } from '@shared/schemas/recycle'
import { requireAbsolute, pathExists } from './list'
import { pickRecycleBinTargets } from './recycleMatch'
import { logMain } from '../logging'

const execFileAsync = promisify(execFile)

const LIST_CAP = 5000

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

  const listed = await listRecycleBin()
  const targets = pickRecycleBinTargets(listed.items, wanted)
  const missing: string[] = []
  for (const w of wanted) {
    const key = w.replace(/[/\\]+$/g, '').toLowerCase()
    const hit = targets.some(
      (t) =>
        t.recyclePath.replace(/[/\\]+$/g, '').toLowerCase() === key ||
        t.originalPath.replace(/[/\\]+$/g, '').toLowerCase() === key
    )
    if (!hit) missing.push(w)
  }
  if (targets.length === 0) return { restored: [], missing }

  const listFile = path.join(os.tmpdir(), `mfe-restore-${process.pid}-${Date.now()}.txt`)
  await fsp.writeFile(listFile, targets.map((t) => t.recyclePath).join('\n'), 'utf8')

  const listLiteral = listFile.replace(/'/g, "''")
  const ps = `
$ErrorActionPreference = 'Continue'
${PS_INVOKE_VERB}
$wanted = @(Get-Content -LiteralPath '${listLiteral}' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
$shell = New-Object -ComObject Shell.Application
$rb = $shell.NameSpace(0xA)
if (-not $rb) { throw 'Recycle Bin namespace unavailable' }
$restored = New-Object System.Collections.Generic.List[string]
foreach ($item in @($rb.Items())) {
  try {
    $rp = ([string]$item.Path).Trim().ToLowerInvariant()
    if (-not $rp -or ($wanted -notcontains $rp)) { continue }
    if (Invoke-MfeBinVerb $item @('restore','wiederherstellen','restaurer','restablecer','ripristina')) {
      [void]$restored.Add(([string]$item.Path).Trim())
    }
  } catch {}
}
$restored | ForEach-Object { $_ }
`

  try {
    const stdout = await runPowerShell(ps, 90_000)
    const reported = new Set(
      stdout
        .split(/\r?\n/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    )

    const restored: string[] = []
    for (const t of targets) {
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
  } finally {
    await fsp.unlink(listFile).catch(() => {})
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

  const listed = await listRecycleBin()
  const targets = pickRecycleBinTargets(listed.items, wanted)
  const missing: string[] = []
  for (const w of wanted) {
    const key = w.replace(/[/\\]+$/g, '').toLowerCase()
    const hit = targets.some(
      (t) =>
        t.recyclePath.replace(/[/\\]+$/g, '').toLowerCase() === key ||
        t.originalPath.replace(/[/\\]+$/g, '').toLowerCase() === key
    )
    if (!hit) missing.push(w)
  }
  if (targets.length === 0) return { deleted: [], missing }

  const listFile = path.join(os.tmpdir(), `mfe-rbdel-${process.pid}-${Date.now()}.txt`)
  await fsp.writeFile(listFile, targets.map((t) => t.recyclePath).join('\n'), 'utf8')
  const listLiteral = listFile.replace(/'/g, "''")
  const ps = `
$ErrorActionPreference = 'Continue'
${PS_INVOKE_VERB}
$wanted = @(Get-Content -LiteralPath '${listLiteral}' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
$shell = New-Object -ComObject Shell.Application
$rb = $shell.NameSpace(0xA)
if (-not $rb) { throw 'Recycle Bin namespace unavailable' }
$deleted = New-Object System.Collections.Generic.List[string]
foreach ($item in @($rb.Items())) {
  try {
    $rp = ([string]$item.Path).Trim().ToLowerInvariant()
    if (-not $rp -or ($wanted -notcontains $rp)) { continue }
    if (Invoke-MfeBinVerb $item @('delete','löschen','supprimer','eliminar','elimina')) {
      [void]$deleted.Add(([string]$item.Path).Trim())
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
    for (const t of targets) {
      const rp = t.recyclePath.replace(/[/\\]+$/g, '').toLowerCase()
      if (reported.has(rp)) deleted.push(t.originalPath)
      else missing.push(t.recyclePath)
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
