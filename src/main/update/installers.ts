import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { AppError } from '@shared/result'
import { isUnderPath, normalizeSlashes, samePath, stripTrailingSep } from '@shared/paths'
import {
  compareVersions,
  isInstallerFileName,
  versionFromInstallerName
} from '@shared/version'
import { requireAbsolute } from '../fs/list'

export type UpdateCandidate = {
  path: string
  fileName: string
  version: string | null
  mtimeMs: number
  newer: boolean
  currentVersion: string
}

function isNewer(candidateVersion: string | null, current: string): boolean {
  if (candidateVersion) return compareVersions(candidateVersion, current) > 0
  // Unversioned name — still offer as a candidate (manual drop-in build).
  return true
}

export async function findUpdateInstaller(rawFolder: string): Promise<UpdateCandidate | null> {
  const currentVersion = app.getVersion()
  if (!rawFolder.trim()) return null
  const folder = requireAbsolute(rawFolder)
  let names: string[]
  try {
    names = await fsp.readdir(folder)
  } catch {
    throw new AppError('not-found', `Updates folder not found: ${folder}`)
  }

  type Hit = { path: string; fileName: string; version: string | null; mtimeMs: number }
  const hits: Hit[] = []
  for (const name of names) {
    if (!isInstallerFileName(name)) continue
    const full = path.join(folder, name)
    let st
    try {
      st = await fsp.stat(full)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    hits.push({
      path: full,
      fileName: name,
      version: versionFromInstallerName(name),
      mtimeMs: st.mtimeMs
    })
  }
  if (hits.length === 0) return null

  hits.sort((a, b) => {
    if (a.version && b.version) {
      const c = compareVersions(a.version, b.version)
      if (c !== 0) return -c
    } else if (a.version && !b.version) return -1
    else if (!a.version && b.version) return 1
    return b.mtimeMs - a.mtimeMs
  })

  const best = hits[0]!
  return {
    path: best.path,
    fileName: best.fileName,
    version: best.version,
    mtimeMs: best.mtimeMs,
    newer: isNewer(best.version, currentVersion),
    currentVersion
  }
}

export async function runUpdateInstaller(
  rawExe: string,
  updatesFolder: string
): Promise<{ launched: true }> {
  const exe = requireAbsolute(rawExe)
  const folder = requireAbsolute(updatesFolder)
  const exeNorm = stripTrailingSep(normalizeSlashes(exe))
  const folderNorm = stripTrailingSep(normalizeSlashes(folder))
  if (!samePath(path.dirname(exeNorm), folderNorm) && !isUnderPath(exeNorm, folderNorm)) {
    throw new AppError('validation', 'Installer must be inside the configured updates folder')
  }
  if (!exeNorm.toLowerCase().endsWith('.exe')) {
    throw new AppError('validation', 'Update file must be a .exe')
  }
  try {
    await fsp.access(exe)
  } catch {
    throw new AppError('not-found', `Installer not found: ${exe}`)
  }

  const child = spawn(exe, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  child.unref()

  // Quit so NSIS can replace the running install.
  setTimeout(() => {
    app.quit()
  }, 400)

  return { launched: true }
}
