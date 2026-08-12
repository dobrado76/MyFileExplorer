import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UPDATES_SOURCE,
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

  it('validates sources', () => {
    expect(isValidUpdatesSource(DEFAULT_UPDATES_SOURCE)).toBe(true)
    expect(isValidUpdatesSource('')).toBe(true)
    expect(isValidUpdatesSource('D:\\Builds\\MFE')).toBe(true)
    expect(isValidUpdatesSource('https://evil.example/releases')).toBe(false)
  })
})
