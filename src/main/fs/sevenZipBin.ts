/**
 * Resolve bundled 7za (7zip-bin). Prefer require.resolve over package path
 * exports — electron-vite otherwise embeds a bad path under out/main.
 */
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(__filename)

export function resolve7zaPath(): string {
  const pkg = require.resolve('7zip-bin/package.json')
  const root = path.dirname(pkg)
  const name = process.platform === 'win32' ? '7za.exe' : '7za'
  let platformDir: string
  if (process.platform === 'darwin') platformDir = 'mac'
  else if (process.platform === 'win32') platformDir = 'win'
  else platformDir = 'linux'
  const bin = path.join(root, platformDir, process.arch, name)
  return bin.replace(/app\.asar(?!\.unpacked)/g, 'app.asar.unpacked')
}
