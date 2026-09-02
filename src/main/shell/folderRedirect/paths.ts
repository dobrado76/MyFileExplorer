import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export function shellRedirectDir(): string {
  const dir = path.join(app.getPath('userData'), 'shell-redirect')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function shellRedirectStatePath(): string {
  return path.join(shellRedirectDir(), 'state.json')
}

export function shellRedirectBackupManifestPath(): string {
  return path.join(shellRedirectDir(), 'backup.json')
}

export function shellRedirectInvocationsPath(): string {
  return path.join(shellRedirectDir(), 'invocations.jsonl')
}

export function shellRedirectRegFragmentPath(subtree: string): string {
  const safe = subtree.replace(/\\/g, '-')
  return path.join(shellRedirectDir(), `${safe}.reg`)
}

export function resolveLauncherPath(): string {
  const override = process.env['MFE_SHELL_LAUNCHER']?.trim()
  if (override) return path.resolve(override)
  return path.join(path.dirname(process.execPath), 'MfeShellLauncher.exe')
}

export function resolveMfeExePath(): string {
  return process.execPath
}
