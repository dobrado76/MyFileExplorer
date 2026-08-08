import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { AppError } from '@shared/result'
import { requireAbsolute, pathExists } from './list'
import { uniqueTargetName } from './ops'

const execFileAsync = promisify(execFile)

function psSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * Explorer-style shortcut file name in `destDir` for a dragged item basename.
 * Prefers `Name.ext.lnk`; on conflict uses `Name.ext - Shortcut.lnk` / `(2)`.
 */
export async function shortcutLinkName(destDir: string, sourceBaseName: string): Promise<string> {
  const preferred = `${sourceBaseName}.lnk`
  if (!(await pathExists(path.join(destDir, preferred)))) return preferred
  const shortcutNamed = `${sourceBaseName} - Shortcut.lnk`
  if (!(await pathExists(path.join(destDir, shortcutNamed)))) return shortcutNamed
  return uniqueTargetName(destDir, shortcutNamed)
}

/**
 * Create Windows `.lnk` shortcuts in `destinationDir` pointing at each source
 * (right-drag “Create shortcuts here”).
 */
export async function createShortcuts(
  sources: string[],
  destinationDir: string
): Promise<{ created: string[] }> {
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'Shortcuts are only available on Windows')
  }
  if (sources.length === 0) {
    throw new AppError('validation', 'No items to create shortcuts for')
  }

  const dest = requireAbsolute(destinationDir)
  let destStat
  try {
    destStat = await fsp.stat(dest)
  } catch {
    throw new AppError('not-found', 'Destination folder not found')
  }
  if (!destStat.isDirectory()) {
    throw new AppError('validation', 'Destination must be a folder')
  }

  const pairs: { lnk: string; target: string; workDir: string }[] = []
  for (const src of sources) {
    const target = requireAbsolute(src)
    let st
    try {
      st = await fsp.stat(target)
    } catch {
      throw new AppError('not-found', `Not found: ${path.basename(target)}`)
    }
    const name = await shortcutLinkName(dest, path.basename(target))
    const lnk = path.join(dest, name)
    // Explorer sets Start in to the file’s folder; leave empty for directories.
    const workDir = st.isDirectory() ? '' : path.dirname(target)
    pairs.push({ lnk, target, workDir })
  }

  const tmp = path.join(os.tmpdir(), `mfe-shortcuts-${randomUUID()}.json`)
  await fsp.writeFile(tmp, JSON.stringify(pairs), 'utf8')
  const cmd = [
    '$ErrorActionPreference = "Stop"',
    `$items = Get-Content -LiteralPath ${psSingleQuote(tmp)} -Raw -Encoding UTF8 | ConvertFrom-Json`,
    'foreach ($i in @($items)) {',
    '  $s = (New-Object -ComObject WScript.Shell).CreateShortcut([string]$i.lnk)',
    '  $s.TargetPath = [string]$i.target',
    '  if ([string]$i.workDir) { $s.WorkingDirectory = [string]$i.workDir }',
    '  $s.Save()',
    '}'
  ].join('\n')

  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 256 * 1024
    })
  } catch (e) {
    const err = e as { stderr?: string; message?: string }
    const detail = (err.stderr ?? err.message ?? '').trim()
    throw new AppError(
      'io',
      'Could not create shortcut',
      detail || undefined
    )
  } finally {
    await fsp.unlink(tmp).catch(() => {})
  }

  // Confirm files landed (PowerShell can “succeed” oddly on some hosts).
  const created: string[] = []
  for (const p of pairs) {
    if (await pathExists(p.lnk)) created.push(p.lnk)
  }
  if (created.length === 0) {
    throw new AppError('io', 'Could not create shortcut')
  }
  return { created }
}
