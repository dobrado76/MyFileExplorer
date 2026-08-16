/**
 * `npm run dist` helper:
 * 1. Bump package.json patch (Major.Minor.Patch) so Check Update sees a newer build
 * 2. Remove previous Setup .exe / .blockmap / latest.yml from dist/
 * 3. Clear dist/win-unpacked (stop any process locking app.asar) then electron-builder
 * 4. If Settings → Updates source is a local folder (not a URL, and not dist/),
 *    copy the new installer there and delete older MyFileExplorer Setup*.exe files
 *
 * Flags:
 *   --no-bump   skip version bump (rebuild same version)
 *   --no-clean  keep prior installers in dist/ (and skip updates-folder prune)
 */
import { Buffer } from 'node:buffer'
import { execSync } from 'node:child_process'
import console from 'node:console'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'dist')
const unpackedDir = path.join(distDir, 'win-unpacked')
const args = new Set(process.argv.slice(2))
const noBump = args.has('--no-bump')
const noClean = args.has('--no-clean')

function readPkgVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  return String(pkg.version ?? '')
}

function isInstallerName(name) {
  return /^myfileexplorer.*\.exe$/i.test(name) && !/\.blockmap$/i.test(name)
}

function cleanInstallersInDir(dir, { keepName = null } = {}) {
  if (!fs.existsSync(dir)) return 0
  let removed = 0
  for (const name of fs.readdirSync(dir)) {
    const lower = name.toLowerCase()
    const isExe = isInstallerName(name)
    const isSidecar =
      /^myfileexplorer.*\.exe\.blockmap$/i.test(name) ||
      lower === 'latest.yml' ||
      lower === 'builder-debug.yml' ||
      lower === 'builder-effective-config.yaml'
    if (!isExe && !isSidecar) continue
    if (keepName && name === keepName) continue
    fs.rmSync(path.join(dir, name), { force: true })
    removed++
    console.log(`removed ${path.relative(root, path.join(dir, name))}`)
  }
  return removed
}

function findNewestSetup(dir) {
  if (!fs.existsSync(dir)) return null
  const hits = []
  for (const name of fs.readdirSync(dir)) {
    if (!isInstallerName(name)) continue
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (!st.isFile()) continue
    hits.push({ name, full, mtimeMs: st.mtimeMs })
  }
  if (hits.length === 0) return null
  hits.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return hits[0]
}

function readUpdatesFolderFromSettings() {
  const appData = process.env.APPDATA
  if (!appData) return null
  const settingsPath = path.join(appData, 'MyFileExplorer', 'settings.json')
  try {
    if (!fs.existsSync(settingsPath)) return null
    const json = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    const folder = typeof json.updatesFolder === 'string' ? json.updatesFolder.trim() : ''
    if (!folder) return null
    // Settings may be a GitHub Releases URL — only sync to a local folder.
    if (/^https?:\/\//i.test(folder)) return null
    return folder
  } catch {
    return null
  }
}

function sameDir(a, b) {
  try {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  } catch {
    return false
  }
}

function publishToUpdatesFolder(updatesFolder, setup) {
  fs.mkdirSync(updatesFolder, { recursive: true })
  const dest = path.join(updatesFolder, setup.name)
  if (!sameDir(path.dirname(setup.full), updatesFolder)) {
    fs.copyFileSync(setup.full, dest)
    console.log(`copied → ${dest}`)
  }
  cleanInstallersInDir(updatesFolder, { keepName: setup.name })
}

/**
 * electron-builder fails with EBUSY on app.asar when a previous win-unpacked
 * MyFileExplorer.exe (or a handle from Explorer/AV) is still open.
 */
function stopProcessesLockingUnpacked() {
  if (process.platform !== 'win32') return
  const script = [
    `$root = ${JSON.stringify(unpackedDir)}`,
    'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |',
    '  Where-Object {',
    '    $_.ExecutablePath -and',
    '    $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)',
    '  } |',
    '  ForEach-Object {',
    '    Write-Host ("stopping PID {0} ({1})" -f $_.ProcessId, $_.ExecutablePath)',
    '    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue',
    '  }'
  ].join('\n')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  try {
    execSync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
      stdio: 'inherit',
      windowsHide: true
    })
  } catch {
    // best-effort
  }
}

async function removeUnpackedDir() {
  if (!fs.existsSync(unpackedDir)) return
  stopProcessesLockingUnpacked()
  const attempts = 8
  for (let i = 1; i <= attempts; i++) {
    try {
      fs.rmSync(unpackedDir, { recursive: true, force: true })
      console.log('removed dist/win-unpacked')
      return
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : ''
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw e
      if (i === attempts) {
        throw new Error(
          `Could not remove dist/win-unpacked (file locked).\n` +
            `Close any MyFileExplorer started from dist\\win-unpacked, then retry.\n` +
            `(Installed app under %LOCALAPPDATA%\\Programs\\MyFileExplorer is fine to leave open.)\n` +
            `Last error: ${e instanceof Error ? e.message : e}`,
          { cause: e }
        )
      }
      console.warn(`dist/win-unpacked busy (attempt ${i}/${attempts}) — retrying…`)
      stopProcessesLockingUnpacked()
      await sleep(400 * i)
    }
  }
}

if (process.platform !== 'win32') {
  console.error('Windows packaging is only supported on a Windows host. For Linux use: npm run build:linux')
  process.exit(1)
}

process.chdir(root)

if (!noBump) {
  const before = readPkgVersion()
  execSync('npm version patch --no-git-tag-version', { stdio: 'inherit' })
  const after = readPkgVersion()
  console.log(`version ${before} → ${after}`)
} else {
  console.log(`version unchanged: ${readPkgVersion()}`)
}

if (!noClean) {
  const n = cleanInstallersInDir(distDir)
  if (n === 0) console.log('dist/: no previous installers to remove')
}

await removeUnpackedDir()

execSync('npm run build:win', { stdio: 'inherit' })

const version = readPkgVersion()
const setup = findNewestSetup(distDir)
if (!setup) {
  console.warn('Warning: no MyFileExplorer-*.exe found in dist/ after build')
} else if (!noClean) {
  cleanInstallersInDir(distDir, { keepName: setup.name })
  const updatesFolder = readUpdatesFolderFromSettings()
  if (updatesFolder) {
    try {
      publishToUpdatesFolder(updatesFolder, setup)
      console.log(`Updates folder pruned (kept ${setup.name})`)
    } catch (e) {
      console.warn(
        `Could not update Settings updates folder: ${e instanceof Error ? e.message : e}`
      )
    }
  }
}

console.log(`\nDone. Installer version: ${version}`)
if (setup) console.log(`Output: ${setup.full}`)
