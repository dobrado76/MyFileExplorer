import path from 'node:path'
import fs from 'node:fs'
import { parseUnc } from '@shared/networkPaths'
import { formatRemoteLocation, parseRemoteLocation } from '@shared/remotePaths'

/**
 * Normalize a UNC path without Node's path.normalize, which collapses
 * bare `\\server` to `\server` (a local absolute path).
 */
function normalizeUncAbsolute(input: string): string | null {
  const withBs = input.replace(/\//g, '\\')
  if (!withBs.startsWith('\\\\')) return null
  // Collapse runs of \ but keep the leading UNC prefix.
  const collapsed = '\\' + withBs.replace(/\\{2,}/g, '\\')
  const body = collapsed.slice(2)
  const rawParts = body.split('\\').filter((p) => p.length > 0)
  const stack: string[] = []
  for (const part of rawParts) {
    if (part === '.') continue
    if (part === '..') {
      // Never climb above the server name.
      if (stack.length <= 1) return null
      stack.pop()
      continue
    }
    stack.push(part)
  }
  if (stack.length === 0) return null
  // Reject empty / illegal server tokens.
  const server = stack[0]!
  if (!server || /[:<>"|?*]/.test(server)) return null
  return '\\\\' + stack.join('\\')
}

/**
 * Normalize to an absolute path or return null when the input is unusable.
 * Rejects anything that still contains `..` segments after normalization
 * (can happen with malformed UNC input) and relative paths.
 */
export function normalizeAbsolute(input: string): string | null {
  if (typeof input !== "string" || input.trim().length === 0) return null;

  let p = input.trim();

  if (p.toLowerCase().startsWith("mfe-remote://")) {
    const loc = parseRemoteLocation(p);
    if (!loc) return null;
    return formatRemoteLocation(loc.connectionId, loc.remotePath);
  }

  // "C:" => "C:\" (Windows)
  if (/^[a-zA-Z]:$/.test(p)) p = p + "\\";

  // Windows drive paths (C:\foo or C:/foo)
  if (/^[a-zA-Z]:/.test(p)) {
    const withBs = p.replace(/\//g, "\\");
    const m = /^([a-zA-Z]:)(\\.*)?$/.exec(withBs);
    if (!m) return null;

    const drive = m[1];
    const restRaw = (m[2] ?? "").replace(/^\\+/, "");
    const rawParts = restRaw.split("\\").filter(Boolean);

    const stack: string[] = [];
    for (const part of rawParts) {
      if (part === ".") continue;
      if (part === "..") {
        if (stack.length === 0) return null;
        stack.pop();
        continue;
      }
      stack.push(part);
    }

    return stack.length === 0 ? drive + "\\" : drive + "\\" + stack.join("\\");
  }

  // UNC (\\server or //server) must be handled before POSIX normalization.
  if (p.startsWith('\\\\') || p.startsWith('//')) {
    return normalizeUncAbsolute(p)
  }

  // POSIX absolute paths only on Linux/posix
  if (p.startsWith('/')) {
    const normalized = path.posix.normalize(p)
    if (!path.posix.isAbsolute(normalized)) return null
    if (normalized.split('/').includes('..')) return null
    return normalized
  }

  return null;
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
    // Skip realpath for bare UNC hosts — they are not filesystem dirs.
    if (parseUnc(n)?.kind === 'host') return
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
