import path from 'node:path'
import fs from 'node:fs'

/**
 * Normalize to an absolute path or return null when the input is unusable.
 * Rejects anything that still contains `..` segments after normalization
 * (can happen with malformed UNC input) and relative paths.
 */
export function normalizeAbsolute(input: string): string | null {
  if (typeof input !== 'string' || input.trim().length === 0) return null
  let p = input.trim()
  // Bare drive like "C:" means "current dir on C:" in Windows — force root.
  if (/^[a-zA-Z]:$/.test(p)) p = p + path.sep
  const normalized = path.normalize(p)
  if (!path.isAbsolute(normalized)) return null
  if (normalized.split(/[\\/]/).includes('..')) return null
  return normalized
}

/** Case-insensitive comparison key on Windows. */
export function pathKey(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

export function isSameOrUnder(candidate: string, root: string): boolean {
  const c = pathKey(candidate)
  const r = pathKey(root)
  if (c === r) return true
  const rootWithSep = r.endsWith(path.sep) ? r : r + path.sep
  return c.startsWith(rootWithSep)
}

/** True when `child` is strictly inside `parent`. */
export function isStrictlyInside(child: string, parent: string): boolean {
  return pathKey(child) !== pathKey(parent) && isSameOrUnder(child, parent)
}

const MAX_ALLOWED_DIRS = 512

/**
 * Allowlist of directories the media protocol may serve from.
 * Directories get approved when main lists them (fs:list), when a preview
 * target is resolved, and for the thumb cache dir. Oldest entries evicted.
 */
export class ProtocolAllowlist {
  private dirs = new Map<string, string>() // key -> normalized path
  private permanent = new Set<string>()

  allowDirPermanently(dir: string): void {
    const n = normalizeAbsolute(dir)
    if (n) this.permanent.add(pathKey(n))
  }

  allowDir(dir: string): void {
    const n = normalizeAbsolute(dir)
    if (!n) return
    const key = pathKey(n)
    this.dirs.delete(key)
    this.dirs.set(key, n)
    if (this.dirs.size > MAX_ALLOWED_DIRS) {
      const oldest = this.dirs.keys().next().value
      if (oldest !== undefined) this.dirs.delete(oldest)
    }
    // Also allow the realpath in case the listed dir is a symlink/junction.
    try {
      const real = fs.realpathSync.native(n)
      if (pathKey(real) !== key) {
        this.dirs.set(pathKey(real), real)
      }
    } catch {
      // unreadable — leave as-is
    }
  }

  isFileAllowed(filePath: string): boolean {
    const n = normalizeAbsolute(filePath)
    if (!n) return false
    // Re-check against realpath so symlinks cannot escape approved roots.
    let real: string
    try {
      real = fs.realpathSync.native(n)
    } catch {
      return false
    }
    for (const candidate of [n, real]) {
      for (const dir of this.permanent) {
        if (isSameOrUnder(pathKey(candidate), dir)) return true
      }
      if (this.dirs.has(pathKey(path.dirname(candidate)))) return true
    }
    return false
  }
}

export const protocolAllowlist = new ProtocolAllowlist()
