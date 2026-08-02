import { describe, expect, it } from 'vitest'
import { compareVersions, versionFromInstallerName } from '@shared/version'

describe('compareVersions', () => {
  it('orders semver-ish strings', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0)
  })
})

describe('versionFromInstallerName', () => {
  it('parses Setup naming', () => {
    expect(versionFromInstallerName('MyFileExplorer Setup 0.1.0.exe')).toBe('0.1.0')
    expect(versionFromInstallerName('MyFileExplorer-0.2.1.exe')).toBe('0.2.1')
  })
})
