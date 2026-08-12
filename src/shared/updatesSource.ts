/** Updates source: local installer folder or GitHub Releases URL. */

/** Public GitHub repository (docs, issues, source). */
export const GITHUB_REPO_URL = 'https://github.com/dobrado76/MyFileExplorer'

/** Default for new installs — public GitHub Releases page. */
export const DEFAULT_UPDATES_SOURCE = `${GITHUB_REPO_URL}/releases`

/** Empty / whitespace → public GitHub Releases URL. */
export function resolveUpdatesSource(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  return s || DEFAULT_UPDATES_SOURCE
}

export function isHttpUpdatesUrl(raw: string): boolean {
  return /^https?:\/\//i.test(raw.trim())
}

export type GithubRepoRef = { owner: string; repo: string }

/**
 * Parse a GitHub repo or releases URL into owner/repo.
 * Accepts:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/releases
 * - https://github.com/owner/repo/releases/latest
 * - https://github.com/owner/repo/releases/tag/v1.2.3
 */
export function parseGithubReleasesUrl(raw: string): GithubRepoRef | null {
  const s = raw.trim()
  if (!s) return null
  let url: URL
  try {
    url = new URL(s)
  } catch {
    return null
  }
  if (!/^github\.com$/i.test(url.hostname)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const owner = parts[0]!
  const repo = parts[1]!.replace(/\.git$/i, '')
  if (!owner || !repo) return null
  if (parts.length >= 3 && parts[2]!.toLowerCase() !== 'releases') {
    // Only allow bare repo or /releases… — not /issues, /tree, etc.
    return null
  }
  return { owner, repo }
}

/** True when the string is a usable updates source after empty→default resolution. */
export function isValidUpdatesSource(raw: string): boolean {
  const s = resolveUpdatesSource(raw)
  if (isHttpUpdatesUrl(s)) return parseGithubReleasesUrl(s) != null
  return true
}
