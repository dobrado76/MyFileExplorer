/**
 * Windows pack: electron-vite + electron-builder.
 * Signing is off via electron-builder.yml `win.signExecutable: false`.
 * CSC_IDENTITY_AUTO_DISCOVERY only affects macOS; we still strip CSC_* so a
 * leftover WIN_CSC_LINK cannot re-enable signing if that flag is removed.
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

const launcherDir = path.join(root, 'tools', 'MfeShellLauncher', 'src', 'MfeShellLauncher')
const launcherPublish = path.join(root, 'tools', 'MfeShellLauncher', 'publish')
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

execSync('electron-vite build && electron-builder --win --config electron-builder.yml --publish never', {
  stdio: 'inherit',
  env: process.env
})
