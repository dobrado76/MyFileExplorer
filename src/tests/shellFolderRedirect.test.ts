import { describe, expect, it } from 'vitest'
import {
  SHELL_REDIRECT_V1_SUBTREES,
  buildLauncherRegistryCommand,
  classifyShellTarget,
  commandsMatch,
  deriveShellRedirectStatus,
  hkcuCommandKey,
  verbFromSubtree
} from '../shared/shellFolderRedirect'

describe('shellFolderRedirect', () => {
  it('lists v1 Directory subtrees only', () => {
    expect(SHELL_REDIRECT_V1_SUBTREES).toEqual([
      'Directory\\shell\\open',
      'Directory\\shell\\explore'
    ])
  })

  it('builds launcher registry command', () => {
    const cmd = buildLauncherRegistryCommand('C:\\Apps\\MfeShellLauncher.exe', 'open')
    expect(cmd).toBe('"C:\\Apps\\MfeShellLauncher.exe" open "%1"')
  })

  it('matches commands case-insensitively', () => {
    expect(
      commandsMatch(
        '"C:\\A\\MfeShellLauncher.exe" open "%1"',
        '"c:\\a\\mfeshelllauncher.exe" open "%1"'
      )
    ).toBe(true)
  })

  it('classifies filesystem vs shell targets', () => {
    expect(classifyShellTarget('D:\\Projects')).toBe('directory')
    expect(classifyShellTarget('\\\\server\\share\\folder')).toBe('directory')
    expect(classifyShellTarget('::{GUID}')).toBe('unsupported')
    expect(classifyShellTarget('shell:Downloads')).toBe('unsupported')
    expect(classifyShellTarget('')).toBe('unsupported')
  })

  it('derives status from registry verification', () => {
    expect(
      deriveShellRedirectStatus({
        userRequested: true,
        launcherExists: true,
        hasBackup: true,
        allKeysMatch: true,
        anyKeyPresent: true
      })
    ).toBe('enabled')
    expect(
      deriveShellRedirectStatus({
        userRequested: true,
        launcherExists: false,
        hasBackup: true,
        allKeysMatch: false,
        anyKeyPresent: true
      })
    ).toBe('missingLauncher')
  })

  it('maps verb from subtree', () => {
    expect(verbFromSubtree('Directory\\shell\\explore')).toBe('explore')
    expect(hkcuCommandKey('Directory\\shell\\open')).toBe(
      'HKCU\\Software\\Classes\\Directory\\shell\\open\\command'
    )
  })
})
