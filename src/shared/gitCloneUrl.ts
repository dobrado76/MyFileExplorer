/**
 * Helpers for New → From Template → GitHub Repository (clone into current folder).
 */

function hasIllegalFolderChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 32) return true
    // <>:"/\|?*
    if (
      c === 60 ||
      c === 62 ||
      c === 58 ||
      c === 34 ||
      c === 47 ||
      c === 92 ||
      c === 124 ||
      c === 63 ||
      c === 42
    ) {
      return true
    }
  }
  return false
}

function stripIllegalFolderChars(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    const c = s.charCodeAt(i)
    if (c < 32) continue
    if (
      c === 60 ||
      c === 62 ||
      c === 58 ||
      c === 34 ||
      c === 47 ||
      c === 92 ||
      c === 124 ||
      c === 63 ||
      c === 42
    ) {
      continue
    }
    out += ch
  }
  return out
}

/** Trim and normalize a clipboard / pasted string for git clone URL detection. */
export function extractGitCloneUrl(raw: string): string | null {
  const t = raw.trim().replace(/^['"]|['"]$/g, '')
  if (!t) return null
  if (!/\s/.test(t) && looksLikeGitCloneUrl(t)) return t
  for (const line of t.split(/[\r\n]+/)) {
    const part = line.trim().replace(/^['"]|['"]$/g, '')
    if (part && looksLikeGitCloneUrl(part)) return part
  }
  return null
}

export function looksLikeGitCloneUrl(s: string): boolean {
  const t = s.trim()
  if (!t || /\s/.test(t)) return false
  if (/\.git$/i.test(t)) return true
  if (/^git@[\w.-]+:[\w./~-]+$/i.test(t)) return true
  if (/^ssh:\/\/git@[\w.-]+\/[\w./~-]+$/i.test(t)) return true
  // Common HTTPS hosts without requiring .git suffix
  if (
    /^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org|dev\.azure\.com)\/[^\s#?]+/i.test(t)
  ) {
    return true
  }
  if (/^https?:\/\/.+\/.+\.git$/i.test(t)) return true
  return false
}

/** Suggest a folder name from a clone URL (e.g. …/MyFileExplorer.git → MyFileExplorer). */
export function folderNameFromGitUrl(url: string): string {
  let s = url.trim()
  // git@host:owner/repo.git
  const scp = /^git@[^:]+:(.+)$/i.exec(s)
  if (scp?.[1]) s = scp[1]
  else {
    try {
      const u = new URL(s)
      s = u.pathname
    } catch {
      /* keep s */
    }
  }
  s = s.replace(/\\/g, '/').replace(/\/+$/, '')
  const seg = s.split('/').filter(Boolean).pop() ?? ''
  return sanitizeFolderName(seg.replace(/\.git$/i, ''))
}

export function sanitizeFolderName(name: string): string {
  const cleaned = stripIllegalFolderChars(name.trim()).replace(/\.+$/g, '').trim()
  return cleaned.slice(0, 200)
}

export function isValidCloneFolderName(name: string): boolean {
  const n = name.trim()
  if (!n || n.length > 200) return false
  if (n === '.' || n === '..') return false
  if (hasIllegalFolderChar(n)) return false
  if (/[. ]$/.test(n)) return false
  return true
}
