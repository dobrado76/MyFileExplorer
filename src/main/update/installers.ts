import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { AppError } from '@shared/result'
import { isUnderPath, normalizeSlashes, samePath, stripTrailingSep } from '@shared/paths'
import {
  compareVersions,
  isInstallerFileName,
  isNewerVersion,
  versionFromInstallerName
} from '@shared/version'
import {
  isHttpUpdatesUrl,
  parseGithubReleasesUrl,
  resolveUpdatesSource
} from '@shared/updatesSource'
import { requireAbsolute } from '../fs/list'
import { logMain } from '../logging'

export type UpdateCandidate = {
  /** Local absolute path when already on disk; empty when only a download URL is known. */
  path: string
  /** GitHub asset URL (or similar) to download before install. */
  downloadUrl?: string
  fileName: string
  version: string | null
  mtimeMs: number
  newer: boolean
  currentVersion: string
  sourceKind: 'folder' | 'url'
}

function tagToVersion(tag: string): string | null {
  const t = tag.trim().replace(/^v/i, '')
  if (!/^\d+(\.\d+)*$/.test(t)) return null
  return t
}

export async function findUpdateInstaller(rawSource: string): Promise<UpdateCandidate | null> {
  const source = resolveUpdatesSource(rawSource)
  if (isHttpUpdatesUrl(source)) return findGithubUpdate(source)
  return findFolderUpdate(source)
}

async function findFolderUpdate(rawFolder: string): Promise<UpdateCandidate | null> {
  const currentVersion = app.getVersion()
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
    newer: isNewerVersion(best.version, currentVersion),
    currentVersion,
    sourceKind: 'folder'
  }
}

type GhReleaseAsset = {
  name?: string
  label?: string
  browser_download_url?: string
  updated_at?: string
}
type GhRelease = {
  tag_name?: string
  published_at?: string
  assets?: GhReleaseAsset[]
}

async function githubFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'MyFileExplorer',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })
  if (!res.ok) {
    throw new AppError(
      'io',
      `GitHub API ${res.status}: could not check releases`,
      res.status === 403
        ? 'GitHub may be rate-limiting unauthenticated requests — try again later.'
        : undefined
    )
  }
  return res.json()
}

async function findGithubUpdate(rawUrl: string): Promise<UpdateCandidate | null> {
  const ref = parseGithubReleasesUrl(rawUrl)
  if (!ref) {
    throw new AppError(
      'validation',
      'Updates URL must be a GitHub repository or releases page',
      'Example: https://github.com/dobrado76/MyFileExplorer/releases'
    )
  }
  const currentVersion = app.getVersion()
  const api = `https://api.github.com/repos/${ref.owner}/${ref.repo}/releases/latest`
  let release: GhRelease
  try {
    release = (await githubFetchJson(api)) as GhRelease
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError('io', e instanceof Error ? e.message : String(e))
  }

  const assets = Array.isArray(release.assets) ? release.assets : []
  const installers = assets.filter(
    (a) => typeof a.name === 'string' && isInstallerFileName(a.name) && a.browser_download_url
  )
  if (installers.length === 0) return null

  const tagVer = typeof release.tag_name === 'string' ? tagToVersion(release.tag_name) : null
  const scored = installers.map((a) => {
    const fileName = a.name!
    const fromName =
      versionFromInstallerName(fileName) ??
      (typeof a.label === 'string' ? versionFromInstallerName(a.label) : null)
    return {
      fileName,
      downloadUrl: a.browser_download_url!,
      version: fromName ?? tagVer,
      mtimeMs: a.updated_at ? Date.parse(a.updated_at) || 0 : 0
    }
  })
  scored.sort((a, b) => {
    if (a.version && b.version) {
      const c = compareVersions(a.version, b.version)
      if (c !== 0) return -c
    } else if (a.version && !b.version) return -1
    else if (!a.version && b.version) return 1
    return b.mtimeMs - a.mtimeMs
  })
  const best = scored[0]!
  return {
    path: '',
    downloadUrl: best.downloadUrl,
    fileName: best.fileName,
    version: best.version,
    mtimeMs: best.mtimeMs,
    newer: isNewerVersion(best.version, currentVersion),
    currentVersion,
    sourceKind: 'url'
  }
}

const TEMP_DIR_PREFIX = 'MyFileExplorer-update-'
/** Seconds to wait after launch before deleting the temp download (NSIS needs time to start). */
const TEMP_CLEANUP_DELAY_SEC = 120

function legacyUpdateCacheDir(): string {
  return path.join(app.getPath('userData'), 'update-cache')
}

function newUpdateTempDir(): string {
  return path.join(
    os.tmpdir(),
    `${TEMP_DIR_PREFIX}${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  )
}

/**
 * Remove leftover URL-download temp folders (and the old userData cache).
 * Safe to call on every startup.
 */
export async function cleanupStaleUpdateTemps(): Promise<void> {
  const tmp = os.tmpdir()
  try {
    const names = await fsp.readdir(tmp)
    for (const name of names) {
      if (!name.startsWith(TEMP_DIR_PREFIX)) continue
      try {
        await fsp.rm(path.join(tmp, name), { recursive: true, force: true })
      } catch {
        /* still locked by an installer — ignore */
      }
    }
  } catch {
    /* ignore */
  }
  try {
    await fsp.rm(legacyUpdateCacheDir(), { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

/** Detached delayed delete so cleanup survives `app.quit()`. */
function scheduleTempDirCleanup(tempDir: string): void {
  if (process.platform === 'win32') {
    const escaped = tempDir.replace(/'/g, "''")
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        `Start-Sleep -Seconds ${TEMP_CLEANUP_DELAY_SEC}; Remove-Item -LiteralPath '${escaped}' -Recurse -Force -ErrorAction SilentlyContinue`
      ],
      { detached: true, stdio: 'ignore', windowsHide: true }
    )
    child.unref()
    return
  }
  const child = spawn(
    'sh',
    ['-c', `sleep ${TEMP_CLEANUP_DELAY_SEC}; rm -rf -- ${JSON.stringify(tempDir)}`],
    { detached: true, stdio: 'ignore' }
  )
  child.unref()
}

async function downloadInstallerToTemp(
  url: string,
  fileName: string
): Promise<{ exe: string; tempDir: string }> {
  if (!isInstallerFileName(fileName)) {
    throw new AppError('validation', 'Update file must be a MyFileExplorer .exe installer')
  }
  const tempDir = newUpdateTempDir()
  await fsp.mkdir(tempDir, { recursive: true })
  const dest = path.join(tempDir, fileName)
  logMain('info', `Downloading update to temp: ${dest}`)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MyFileExplorer' },
      redirect: 'follow'
    })
    if (!res.ok) {
      throw new AppError('io', `Download failed (${res.status})`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 1024) {
      throw new AppError('io', 'Downloaded file looks too small to be an installer')
    }
    await fsp.writeFile(dest, buf)
    return { exe: dest, tempDir }
  } catch (e) {
    try {
      await fsp.rm(tempDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    throw e
  }
}

export async function runUpdateInstaller(
  rawExe: string,
  updatesSource: string,
  downloadUrl?: string,
  knownVersion?: string | null
): Promise<{ launched: true }> {
  const source = resolveUpdatesSource(updatesSource)
  let exe: string
  let tempDir: string | null = null

  if (downloadUrl?.trim()) {
    if (!isHttpUpdatesUrl(source) || !parseGithubReleasesUrl(source)) {
      throw new AppError('validation', 'Download updates require a GitHub releases URL as the source')
    }
    const name = path.basename(rawExe.trim() || 'installer.exe')
    const dl = await downloadInstallerToTemp(downloadUrl.trim(), name)
    exe = dl.exe
    tempDir = dl.tempDir
  } else {
    exe = requireAbsolute(rawExe)
    const folder = requireAbsolute(source)
    const exeNorm = stripTrailingSep(normalizeSlashes(exe))
    const folderNorm = stripTrailingSep(normalizeSlashes(folder))
    if (!samePath(path.dirname(exeNorm), folderNorm) && !isUnderPath(exeNorm, folderNorm)) {
      throw new AppError('validation', 'Installer must be inside the configured updates folder')
    }
  }

  const exeNorm = stripTrailingSep(normalizeSlashes(exe))
  if (!exeNorm.toLowerCase().endsWith('.exe')) {
    throw new AppError('validation', 'Update file must be a .exe')
  }
  try {
    await fsp.access(exe)
  } catch {
    throw new AppError('not-found', `Installer not found: ${exe}`)
  }

  const fromName = versionFromInstallerName(path.basename(exe))
  const known = knownVersion?.trim() || null
  const candidateVer = fromName ?? (known && /^\d+(\.\d+)*$/.test(known) ? known : null)
  const currentVersion = app.getVersion()
  if (!isNewerVersion(candidateVer, currentVersion)) {
    throw new AppError(
      'validation',
      candidateVer
        ? `Installer v${candidateVer} is not newer than installed ${currentVersion}`
        : 'Installer has no version in its name — only versioned Setup builds can be installed from Check for update'
    )
  }

  const child = spawn(exe, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  child.unref()

  if (tempDir) {
    scheduleTempDirCleanup(tempDir)
  }

  // Quit so NSIS can replace the running install.
  setTimeout(() => {
    app.quit()
  }, 400)

  return { launched: true }
}
