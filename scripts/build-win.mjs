/**
 * Windows pack: electron-vite + electron-builder.
 * Signing is off via electron-builder.yml `win.signExecutable: false`.
 * CSC_IDENTITY_AUTO_DISCOVERY only affects macOS; we still strip CSC_* so a
 * leftover WIN_CSC_LINK cannot re-enable signing if that flag is removed.
 *
 * Default (local `npm run dist` / `build:win`): pack MyFileExplorer only.
 * MfeShellLauncher, bundled mpv, and the VC++ CRT DLLs are reused from the
 * last full pack. `--full`, `npm run dist:full`, or CI rebuilds those.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { clearWinUnpackedOutput } from './winUnpackedCleanup.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

{
  const pkgPath = path.join(root, 'package.json')
  const raw = fs.readFileSync(pkgPath)
  if (raw.length === 0 || (raw[0] !== 0x7b && raw[0] !== 0x5b)) {
    throw new Error(
      `package.json is not valid JSON (first byte 0x${raw[0]?.toString(16) ?? '??'}). Restore from git before packaging.`
    )
  }
  JSON.parse(raw.toString('utf8'))
}

// 7z ultra (-mx=9) dies on this ~700MB unpacked tree (onnx/ffmpeg/asar).
// electron-builder.yml `compression: normal` does not change 7z level — only this env does.
if (!process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL) {
  process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL = '5'
}

process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
delete process.env.CSC_LINK
delete process.env.WIN_CSC_LINK
delete process.env.CSC_KEY_PASSWORD
delete process.env.WIN_CSC_KEY_PASSWORD

process.chdir(root)

const full = process.argv.includes('--full') || process.env.CI === 'true'
const launcherPublish = path.join(root, 'tools', 'MfeShellLauncher', 'publish')
const launcherExe = path.join(launcherPublish, 'MfeShellLauncher.exe')
const mpvExe = path.join(root, 'tools', 'mpv', 'mpv.exe')
const vcDir = path.join(root, 'build', 'vc-redist')
const vcDlls = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']

function vcDllsPresent() {
  return vcDlls.every((name) => fs.existsSync(path.join(vcDir, name)))
}

if (full) {
  console.log('side tools: rebuilding MfeShellLauncher, mpv, and VC++ DLLs')
  const launcherDir = path.join(root, 'tools', 'MfeShellLauncher', 'src', 'MfeShellLauncher')
  try {
    execSync(
      `dotnet publish "${launcherDir}" -c Release -r win-x64 -p:PublishSingleFile=true -o "${launcherPublish}"`,
      { stdio: 'inherit', env: process.env }
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (process.env.CI === 'true') {
      throw new Error(`MfeShellLauncher publish failed in CI: ${msg}`, { cause: e })
    }
    console.warn(
      'MfeShellLauncher publish failed (dotnet missing?). Pack will continue without launcher:',
      msg
    )
  }

  try {
    execSync('node scripts/fetch-mpv.mjs', { stdio: 'inherit', env: process.env })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('fetch-mpv failed — Rich player will not be bundled:', msg)
  }

  // koffi.node imports the VC++ CRT. Without these DLLs, Win10 machines that
  // never installed the redistributable crash on startup before main.log.
  execSync('node scripts/stage-vc-redist.mjs', { stdio: 'inherit', env: process.env })
} else {
  console.log('side tools: reusing MfeShellLauncher, mpv, and VC++ DLLs (npm run dist:full rebuilds them)')
  if (!fs.existsSync(launcherExe)) {
    throw new Error(
      'MfeShellLauncher.exe is not in tools/MfeShellLauncher/publish. Run npm run dist:full once.'
    )
  }
  console.log('MfeShellLauncher: reusing tools/MfeShellLauncher/publish/MfeShellLauncher.exe')
  if (!fs.existsSync(mpvExe)) {
    console.warn(
      'mpv.exe is not in tools/mpv — Rich player will not be bundled. Run npm run dist:full or npm run tools:fetch-mpv.'
    )
  } else {
    console.log('mpv: reusing tools/mpv')
  }
  if (!vcDllsPresent()) {
    throw new Error(
      `VC++ CRT DLLs are not in build/vc-redist (${vcDlls.join(', ')}). Run npm run dist:full once.`
    )
  }
  console.log('vc-redist: reusing build/vc-redist')
}

await clearWinUnpackedOutput(root)

execSync('electron-vite build && electron-builder --win --config electron-builder.yml --publish never', {
  stdio: 'inherit',
  env: process.env
})
