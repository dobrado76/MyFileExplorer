/**
 * electron-builder packs into dist/win-unpacked.tmp then renames onto
 * dist/win-unpacked. A previous MyFileExplorer.exe from that folder (or a
 * leftover .tmp) yields EPERM/EBUSY on rename.
 */
import { Buffer } from 'node:buffer'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

export function unpackedOutputDirs(root) {
  const distDir = path.join(root, 'dist')
  return {
    distDir,
    unpackedDir: path.join(distDir, 'win-unpacked'),
    unpackedTmpDir: path.join(distDir, 'win-unpacked.tmp')
  }
}

function stopProcessesUnder(dir) {
  if (process.platform !== 'win32') return
  const script = [
    '$ProgressPreference = "SilentlyContinue"',
    `$root = ${JSON.stringify(dir)}`,
    `$self = ${process.pid}`,
    `$parent = ${process.ppid}`,
    'if (-not $root) { return }',
    'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |',
    '  Where-Object {',
    '    $_.ProcessId -ne $self -and $_.ProcessId -ne $parent -and',
    '    (',
    '      ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) -or',
    '      ($_.CommandLine -and $_.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0)',
    '    )',
    '  } |',
    '  ForEach-Object {',
    '    Write-Host ("stopping PID {0} ({1})" -f $_.ProcessId, $_.Name)',
    '    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue',
    '  }'
  ].join('\n')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  try {
    execSync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
      stdio: ['ignore', 'inherit', 'ignore'],
      windowsHide: true
    })
  } catch {
    // best-effort
  }
}

function sweepStaleDirs(distDir) {
  if (!fs.existsSync(distDir)) return
  for (const name of fs.readdirSync(distDir)) {
    if (!/^win-unpacked(\.tmp)?\.stale-\d+$/i.test(name)) continue
    const full = path.join(distDir, name)
    try {
      fs.rmSync(full, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 })
      console.log(`removed leftover ${name}`)
    } catch {
      // AV may still be scanning; leave for a later build
    }
  }
}

async function removeDirWithRetry(dir, label) {
  if (!fs.existsSync(dir)) return
  stopProcessesUnder(dir)
  const attempts = 8
  for (let i = 1; i <= attempts; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 })
      console.log(`removed ${label}`)
      return
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : ''
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw e
      if (i < attempts) {
        console.warn(`${label} busy (attempt ${i}/${attempts}) — retrying…`)
        stopProcessesUnder(dir)
        await sleep(400 * i)
        continue
      }
      // Windows: a locked file often still lets the parent directory be renamed.
      const stale = `${dir}.stale-${Date.now()}`
      try {
        fs.renameSync(dir, stale)
        console.warn(`moved locked ${label} aside → ${path.basename(stale)}`)
        return
      } catch (renameErr) {
        throw new Error(
          `Could not remove ${label} (file locked).\n` +
            `Close any MyFileExplorer started from dist\\win-unpacked, then retry.\n` +
            `(Installed app under %LOCALAPPDATA%\\Programs\\MyFileExplorer is fine to leave open.)\n` +
            `Last error: ${e instanceof Error ? e.message : e}` +
            `; rename: ${renameErr instanceof Error ? renameErr.message : renameErr}`,
          { cause: renameErr }
        )
      }
    }
  }
}

/** Stop unpacked-app processes and delete dist/win-unpacked(+.tmp). */
export async function clearWinUnpackedOutput(root) {
  const { distDir, unpackedDir, unpackedTmpDir } = unpackedOutputDirs(root)
  sweepStaleDirs(distDir)
  stopProcessesUnder(unpackedDir)
  stopProcessesUnder(unpackedTmpDir)
  await removeDirWithRetry(unpackedTmpDir, 'dist/win-unpacked.tmp')
  await removeDirWithRetry(unpackedDir, 'dist/win-unpacked')
}
