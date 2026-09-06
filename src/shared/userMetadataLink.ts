/**
 * Link-type user metadata: http(s) URLs, absolute paths, or paths relative to the item.
 */

import { isSingleHttpUrl } from './schemas/clipboardPaste'

export const MAX_LINK_VALUE_LEN = 2048

export type UserMetadataLinkTarget =
  | { kind: 'url'; url: string }
  | { kind: 'path'; path: string }

function normalizeWinSeparators(p: string): string {
  return p.replace(/\//g, '\\')
}

/** Drive (`C:\…`) or UNC (`\\server\share\…`). */
export function isAbsoluteWindowsPath(raw: string): boolean {
  const n = normalizeWinSeparators(raw.trim())
  if (/^[a-zA-Z]:\\/.test(n)) return true
  if (/^\\\\[^\\]+\\[^\\]+/.test(n)) return true
  return false
}

function tryParseFileUrl(raw: string): string | null {
  const t = raw.trim()
  if (!/^file:/i.test(t)) return null
  try {
    const u = new URL(t)
    if (u.protocol !== 'file:') return null
    let p = decodeURIComponent(u.pathname)
    // file:///C:/foo → /C:/foo → C:\foo
    if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1)
    return normalizeWinSeparators(p)
  } catch {
    return null
  }
}

/** Join a relative Windows path onto an absolute base directory. */
export function joinWindowsPath(baseDir: string, relative: string): string {
  const base = normalizeWinSeparators(baseDir.trim()).replace(/\\+$/, '')
  const rel = normalizeWinSeparators(relative.trim())
  if (isAbsoluteWindowsPath(rel)) return rel

  const unc = base.startsWith('\\\\')
  const drive = /^([a-zA-Z]:)(.*)$/.exec(base)
  let parts: string[]
  let prefix: string
  if (unc) {
    prefix = '\\\\'
    parts = base.slice(2).split('\\').filter(Boolean)
  } else if (drive) {
    prefix = drive[1]!
    parts = (drive[2] ?? '').split('\\').filter(Boolean)
  } else {
    prefix = ''
    parts = base.split('\\').filter(Boolean)
  }

  for (const seg of rel.split('\\').filter(Boolean)) {
    if (seg === '.') continue
    if (seg === '..') {
      if (unc && parts.length <= 2) continue
      if (drive && parts.length === 0) continue
      parts.pop()
      continue
    }
    parts.push(seg)
  }

  if (unc) return prefix + parts.join('\\')
  if (drive) return parts.length ? `${prefix}\\${parts.join('\\')}` : `${prefix}\\`
  return parts.join('\\')
}

function looksLikeRelativePath(raw: string): boolean {
  const t = raw.trim()
  if (!t || /[\0\r\n]/.test(t)) return false
  // Reject URI schemes (http:, javascript:, …) — file: handled separately.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) return false
  return true
}

/**
 * Classify a stored link value. Relative paths need `baseDir` (folder of the item,
 * or the folder itself when the item is a directory) to resolve.
 */
export function classifyUserMetadataLink(
  raw: string,
  baseDir?: string | null
): UserMetadataLinkTarget | null {
  const t = raw.trim()
  if (!t) return null

  if (isSingleHttpUrl(t)) {
    return { kind: 'url', url: t }
  }

  const fromFile = tryParseFileUrl(t)
  if (fromFile) {
    return { kind: 'path', path: fromFile }
  }

  if (isAbsoluteWindowsPath(t)) {
    return { kind: 'path', path: normalizeWinSeparators(t) }
  }

  if (looksLikeRelativePath(t) && baseDir && isAbsoluteWindowsPath(baseDir)) {
    return { kind: 'path', path: joinWindowsPath(baseDir, t) }
  }

  // Storeable relative path without a base — treat as path for display; follow needs base.
  if (looksLikeRelativePath(t)) {
    return { kind: 'path', path: normalizeWinSeparators(t) }
  }

  return null
}

/** Soft client + main write gate: empty clears; otherwise must be URL or path-like. */
export function validateUserMetadataLinkValue(
  raw: string
): { ok: true } | { ok: false; message: string } {
  const t = raw.trim()
  if (!t) return { ok: true }
  if (t.length > MAX_LINK_VALUE_LEN) {
    return { ok: false, message: `Link is too long (max ${MAX_LINK_VALUE_LEN} characters)` }
  }
  if (isSingleHttpUrl(t) || tryParseFileUrl(t) || isAbsoluteWindowsPath(t) || looksLikeRelativePath(t)) {
    return { ok: true }
  }
  return {
    ok: false,
    message: 'Enter an http(s) URL, or a file/folder path (absolute or relative to this item)'
  }
}

export function canFollowUserMetadataLink(raw: string, baseDir?: string | null): boolean {
  const t = raw.trim()
  if (!t) return false
  if (isSingleHttpUrl(t) || tryParseFileUrl(t) || isAbsoluteWindowsPath(t)) return true
  if (looksLikeRelativePath(t) && baseDir && isAbsoluteWindowsPath(baseDir)) return true
  return false
}

function splitWindowsPath(p: string): { root: string; parts: string[] } | null {
  const n = normalizeWinSeparators(p.trim()).replace(/\\+$/, '')
  if (n.startsWith('\\\\')) {
    const parts = n.slice(2).split('\\').filter(Boolean)
    if (parts.length < 2) return null
    return {
      root: `\\\\${parts[0]}\\${parts[1]}`.toLowerCase(),
      parts: parts.slice(2)
    }
  }
  const m = /^([a-zA-Z]:)(?:\\(.*))?$/.exec(n)
  if (!m) return null
  return {
    root: m[1]!.toLowerCase(),
    parts: (m[2] ?? '').split('\\').filter(Boolean)
  }
}

/**
 * Relative path from `baseDir` to `absoluteTarget` (same drive/share), or null.
 * Example: base `C:\Proj`, target `C:\Proj\docs\a.md` → `docs\a.md`.
 */
export function windowsPathRelativeTo(baseDir: string, absoluteTarget: string): string | null {
  const a = splitWindowsPath(baseDir)
  const b = splitWindowsPath(absoluteTarget)
  if (!a || !b || a.root !== b.root) return null
  let i = 0
  while (
    i < a.parts.length &&
    i < b.parts.length &&
    a.parts[i]!.toLowerCase() === b.parts[i]!.toLowerCase()
  ) {
    i++
  }
  const ups = a.parts.length - i
  const relParts = [...Array.from({ length: ups }, () => '..'), ...b.parts.slice(i)]
  return relParts.length === 0 ? '.' : relParts.join('\\')
}

/** Prefer absolute; with `preferRelative` + baseDir, store a relative path when possible. */
export function formatUserMetadataLinkPath(
  absolutePath: string,
  baseDir: string | null | undefined,
  preferRelative: boolean
): string {
  const abs = normalizeWinSeparators(absolutePath.trim())
  if (!preferRelative || !baseDir) return abs
  return windowsPathRelativeTo(baseDir, abs) ?? abs
}
