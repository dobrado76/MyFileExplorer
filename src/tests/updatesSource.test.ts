import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UPDATES_SOURCE,
  githubReleaseNotesFileUrls,
  githubRepoForReleaseNotes,
  isHttpUpdatesUrl,
  isValidUpdatesSource,
  parseGithubReleasesUrl,
  resolveUpdatesSource
} from '../shared/updatesSource'

describe('updatesSource', () => {
  it('defaults to the public releases page', () => {
    expect(DEFAULT_UPDATES_SOURCE).toBe(
      'https://github.com/dobrado76/MyFileExplorer/releases'
    )
  })

  it('resolves empty to the default GitHub URL', () => {
    expect(resolveUpdatesSource('')).toBe(DEFAULT_UPDATES_SOURCE)
    expect(resolveUpdatesSource('   ')).toBe(DEFAULT_UPDATES_SOURCE)
    expect(resolveUpdatesSource('D:\\Builds')).toBe('D:\\Builds')
  })

  it('detects http(s) URLs', () => {
    expect(isHttpUpdatesUrl('https://github.com/a/b/releases')).toBe(true)
    expect(isHttpUpdatesUrl('D:\\Builds')).toBe(false)
  })

  it('parses GitHub releases / repo URLs', () => {
    expect(parseGithubReleasesUrl('https://github.com/dobrado76/MyFileExplorer/releases')).toEqual({
      owner: 'dobrado76',
      repo: 'MyFileExplorer'
    })
    expect(
      parseGithubReleasesUrl('https://github.com/dobrado76/MyFileExplorer/releases/latest')
    ).toEqual({ owner: 'dobrado76', repo: 'MyFileExplorer' })
    expect(parseGithubReleasesUrl('https://github.com/dobrado76/MyFileExplorer')).toEqual({
      owner: 'dobrado76',
      repo: 'MyFileExplorer'
    })
    expect(parseGithubReleasesUrl('https://github.com/dobrado76/MyFileExplorer/issues')).toBeNull()
    expect(parseGithubReleasesUrl('https://example.com/x')).toBeNull()
  })

  it('resolves release-notes repo from URL or local folder', () => {
    expect(
      githubRepoForReleaseNotes('https://github.com/dobrado76/MyFileExplorer/releases')
    ).toEqual({ owner: 'dobrado76', repo: 'MyFileExplorer' })
    expect(githubRepoForReleaseNotes('D:\\Builds')).toEqual({
      owner: 'dobrado76',
      repo: 'MyFileExplorer'
    })
    expect(githubRepoForReleaseNotes('')).toEqual({
      owner: 'dobrado76',
      repo: 'MyFileExplorer'
    })
  })

  it('builds RELEASE_NOTES.md raw URLs for a version then main/master', () => {
    const ref = { owner: 'dobrado76', repo: 'MyFileExplorer' }
    expect(githubReleaseNotesFileUrls(ref, '0.14.0')).toEqual([
      {
        gitRef: 'v0.14.0',
        rawUrl:
          'https://raw.githubusercontent.com/dobrado76/MyFileExplorer/v0.14.0/RELEASE_NOTES.md',
        htmlUrl: 'https://github.com/dobrado76/MyFileExplorer/blob/v0.14.0/RELEASE_NOTES.md'
      },
      {
        gitRef: '0.14.0',
        rawUrl:
          'https://raw.githubusercontent.com/dobrado76/MyFileExplorer/0.14.0/RELEASE_NOTES.md',
        htmlUrl: 'https://github.com/dobrado76/MyFileExplorer/blob/0.14.0/RELEASE_NOTES.md'
      },
      {
        gitRef: 'main',
        rawUrl:
          'https://raw.githubusercontent.com/dobrado76/MyFileExplorer/main/RELEASE_NOTES.md',
        htmlUrl: 'https://github.com/dobrado76/MyFileExplorer/blob/main/RELEASE_NOTES.md'
      },
      {
        gitRef: 'master',
        rawUrl:
          'https://raw.githubusercontent.com/dobrado76/MyFileExplorer/master/RELEASE_NOTES.md',
        htmlUrl: 'https://github.com/dobrado76/MyFileExplorer/blob/master/RELEASE_NOTES.md'
      }
    ])
    expect(githubReleaseNotesFileUrls(ref, null).map((c) => c.gitRef)).toEqual(['main', 'master'])
  })

  it('validates sources', () => {
    expect(isValidUpdatesSource(DEFAULT_UPDATES_SOURCE)).toBe(true)
    expect(isValidUpdatesSource('')).toBe(true)
    expect(isValidUpdatesSource('D:\\Builds\\MFE')).toBe(true)
    expect(isValidUpdatesSource('https://evil.example/releases')).toBe(false)
  })
})
