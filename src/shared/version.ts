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

/** Match `MyFileExplorer Setup 0.1.0.exe` / `MyFileExplorer-0.1.0.exe`. */
const SETUP_VERSION_RE = /^myfileexplorer(?:\s+setup)?[\s_-]*v?(\d+(?:\.\d+)*)\.exe$/i

export function versionFromInstallerName(name: string): string | null {
  const m = SETUP_VERSION_RE.exec(name)
  return m?.[1] ?? null
}

export function isInstallerFileName(name: string): boolean {
  return /^myfileexplorer.*\.exe$/i.test(name)
}
