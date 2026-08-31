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

/**
 * Repo used when fetching RELEASE_NOTES.md.
 * Always the online GitHub repo — never a local updates folder.
 * Custom GitHub updates URLs use that repo; folders use the public default.
 */
export function githubRepoForReleaseNotes(rawSource: string): GithubRepoRef | null {
  const source = resolveUpdatesSource(rawSource)
  if (isHttpUpdatesUrl(source)) {
    return parseGithubReleasesUrl(source) ?? parseGithubReleasesUrl(DEFAULT_UPDATES_SOURCE)
  }
  return parseGithubReleasesUrl(DEFAULT_UPDATES_SOURCE)
}

const RELEASE_NOTES_FILE = 'RELEASE_NOTES.md'

/** Raw + browse URLs for RELEASE_NOTES.md (version tags, then main/master). */
export function githubReleaseNotesFileUrls(
  ref: GithubRepoRef,
  version?: string | null
): Array<{ gitRef: string; rawUrl: string; htmlUrl: string }> {
  const refs: string[] = []
  const ver = (version ?? '').trim().replace(/^v/i, '')
  if (ver && /^\d+(\.\d+)*$/.test(ver)) {
    refs.push(`v${ver}`, ver)
  }
  refs.push('main', 'master')
  return refs.map((gitRef) => ({
    gitRef,
    rawUrl: `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${gitRef}/${RELEASE_NOTES_FILE}`,
    htmlUrl: `https://github.com/${ref.owner}/${ref.repo}/blob/${gitRef}/${RELEASE_NOTES_FILE}`
  }))
}

/** True when the string is a usable updates source after empty→default resolution. */
export function isValidUpdatesSource(raw: string): boolean {
  const s = resolveUpdatesSource(raw)
  if (isHttpUpdatesUrl(s)) return parseGithubReleasesUrl(s) != null
  return true
}
