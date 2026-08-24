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
execSync('electron-vite build && electron-builder --win --config electron-builder.yml --publish never', {
  stdio: 'inherit',
  env: process.env
})
