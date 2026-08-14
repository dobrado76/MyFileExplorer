import { describe, expect, it } from 'vitest'
import { compareVersions, isNewerVersion, versionFromInstallerName } from '@shared/version'

describe('compareVersions', () => {
  it('orders semver-ish strings', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0)
  })
})

describe('isNewerVersion', () => {
  it('requires a strictly higher version', () => {
    expect(isNewerVersion('0.6.5', '0.6.4')).toBe(true)
    expect(isNewerVersion('0.6.4', '0.6.4')).toBe(false)
    expect(isNewerVersion('0.6.3', '0.6.4')).toBe(false)
    expect(isNewerVersion(null, '0.6.4')).toBe(false)
  })
})

describe('versionFromInstallerName', () => {
  it('parses Setup naming', () => {
    expect(versionFromInstallerName('MyFileExplorer Setup 0.1.0.exe')).toBe('0.1.0')
    expect(versionFromInstallerName('MyFileExplorer-0.2.1.exe')).toBe('0.2.1')
  })

  it('parses GitHub asset names that replace spaces with dots', () => {
    expect(versionFromInstallerName('MyFileExplorer.Setup.0.7.1.exe')).toBe('0.7.1')
    expect(versionFromInstallerName('MyFileExplorer.0.7.1.exe')).toBe('0.7.1')
  })

  it('parses hyphenated Setup names', () => {
    expect(versionFromInstallerName('MyFileExplorer-Setup-0.7.1.exe')).toBe('0.7.1')
  })

  it('rejects unversioned Setup builds', () => {
    expect(versionFromInstallerName('MyFileExplorer Setup.exe')).toBeNull()
    expect(versionFromInstallerName('MyFileExplorer.Setup.exe')).toBeNull()
  })
})
