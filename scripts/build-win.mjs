/**
 * Windows pack: electron-vite + electron-builder, never Authenticode-sign.
 * Local Windows cert auto-discovery made `dist` wait minutes on signtool.
 * Public installers come from GitHub Actions and are also unsigned.
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
