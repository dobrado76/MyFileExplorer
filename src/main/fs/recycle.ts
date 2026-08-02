import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { AppError } from '@shared/result'
import { requireAbsolute, pathExists } from './list'

const execFileAsync = promisify(execFile)

/**
 * Restore items from the Windows Recycle Bin by original full path.
 * Matches Shell.Application namespace 0xA (Recycle Bin) via PowerShell COM.
 */
export async function restoreFromRecycleBin(
  originalPaths: string[]
): Promise<{ restored: string[]; missing: string[] }> {
  if (process.platform !== 'win32') {
    throw new AppError('validation', 'Recycle Bin restore is only available on Windows')
  }
  const wanted = originalPaths.map((p) => requireAbsolute(p))
  if (wanted.length === 0) return { restored: [], missing: [] }

  const listFile = path.join(
    os.tmpdir(),
    `mfe-restore-${process.pid}-${Date.now()}.txt`
  )
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
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { timeout: 90_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
    )
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
        // Verb may have restored without stdout echo matching
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
