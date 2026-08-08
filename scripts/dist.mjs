/**
 * `npm run dist` helper:
 * 1. Bump package.json patch (Major.Minor.Patch) so Check Update sees a newer build
 * 2. Remove previous Setup .exe / .blockmap / latest.yml from dist/
 * 3. Run electron-builder Windows build
 * 4. If Settings → Updates folder is set (and not dist/), copy the new installer
 *    there and delete older MyFileExplorer Setup*.exe files in that folder
 *
 * Flags:
 *   --no-bump   skip version bump (rebuild same version)
 *   --no-clean  keep prior installers in dist/ (and skip updates-folder prune)
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'dist')
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
    return folder || null
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

execSync('npm run build:win', { stdio: 'inherit' })

const version = readPkgVersion()
const setup = findNewestSetup(distDir)
if (!setup) {
  console.warn('Warning: no MyFileExplorer Setup *.exe found in dist/ after build')
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
