/** True only when candidate is a strictly higher semver than the running app. */
export function isNewerVersion(candidateVersion: string | null, current: string): boolean {
  if (!candidateVersion) return false
  const cur = current.trim()
  if (!cur) return true
  return compareVersions(candidateVersion, cur) > 0
}

function parseVersionParts(v: string): number[] {
  return v.split('.').map((p) => {
    const n = Number.parseInt(p, 10)
    return Number.isFinite(n) ? n : 0
  })
}

/** Compare semver-ish strings; positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const ap = parseVersionParts(a)
  const bp = parseVersionParts(b)
  const len = Math.max(ap.length, bp.length)
  for (let i = 0; i < len; i++) {
    const d = (ap[i] ?? 0) - (bp[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * Match `MyFileExplorer Setup 0.1.0.exe`, `MyFileExplorer-0.1.0.exe`,
 * and GitHub asset names that replace spaces with dots (`MyFileExplorer.Setup.0.7.1.exe`).
 */
const SETUP_VERSION_RE = /^myfileexplorer(?:[\s._-]+setup)?[\s._-]*v?(\d+(?:\.\d+)*)\.exe$/i
const LOOSE_SETUP_VERSION_RE = /^myfileexplorer.+\.exe$/i
const TRAILING_VERSION_RE = /(\d+\.\d+(?:\.\d+)*)\.exe$/i

export function versionFromInstallerName(name: string): string | null {
  const base = name.trim()
  const m = SETUP_VERSION_RE.exec(base)
  if (m?.[1]) return m[1]
  if (!LOOSE_SETUP_VERSION_RE.test(base)) return null
  return TRAILING_VERSION_RE.exec(base)?.[1] ?? null
}

export function isInstallerFileName(name: string): boolean {
  return /^myfileexplorer.*\.exe$/i.test(name)
}
