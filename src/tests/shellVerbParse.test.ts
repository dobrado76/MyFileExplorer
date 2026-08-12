import { describe, expect, it } from 'vitest'
import {
  discoverVerbId,
  normalizeExecutableKey,
  parseShellCommandLine,
  sameCustomCommand,
  tokenizeCommandLine
} from '../shared/shellVerbParse'

describe('shellVerbParse', () => {
  it('tokenizes quoted paths', () => {
    expect(tokenizeCommandLine('"C:\\Program Files\\App\\a.exe" "%1"')).toEqual([
      'C:\\Program Files\\App\\a.exe',
      '%1'
    ])
  })

  it('maps %1 to {path}', () => {
    const p = parseShellCommandLine('"C:\\Tools\\edit.exe" "%1"')
    expect(p).toEqual({
      executable: 'C:\\Tools\\edit.exe',
      argsTemplate: '{path}'
    })
  })

  it('maps multiple args and %*', () => {
    const p = parseShellCommandLine('C:\\bin\\x.exe --fullscreen %*')
    expect(p?.executable).toBe('C:\\bin\\x.exe')
    expect(p?.argsTemplate).toBe('--fullscreen {paths}')
  })

  it('rejoins unquoted Program Files paths split on spaces', () => {
    const p = parseShellCommandLine(
      'C:\\Program Files\\ACD Systems\\ACDSee\\ACDSeeQV.exe /s "%1"'
    )
    expect(p?.executable).toBe('C:\\Program Files\\ACD Systems\\ACDSee\\ACDSeeQV.exe')
    expect(p?.argsTemplate).toBe('/s {path}')
  })

  it('rejoins unquoted %ProgramFiles% paths with spaces', () => {
    const p = parseShellCommandLine('%ProgramFiles%\\ACD Systems\\ACDSee\\ACDSee.exe %1')
    expect(p?.executable).toBe('%ProgramFiles%\\ACD Systems\\ACDSee\\ACDSee.exe')
    expect(p?.argsTemplate).toBe('{path}')
  })

  it('rejects rundll32 and ms-settings', () => {
    expect(parseShellCommandLine('rundll32.exe shell32.dll,OpenAs_RunDLL %1')).toBeNull()
    expect(parseShellCommandLine('ms-settings:defaultapps')).toBeNull()
  })

  it('dedupes by exe + label', () => {
    expect(
      sameCustomCommand(
        { executable: 'C:\\A\\App.exe', label: 'Edit' },
        { executable: 'c:/a/app.exe', label: 'edit' }
      )
    ).toBe(true)
    expect(normalizeExecutableKey('"C:/A/App.exe"')).toBe('c:\\a\\app.exe')
  })

  it('builds stable discover ids', () => {
    const a = discoverVerbId('HKCR\\*\\shell', 'edit')
    const b = discoverVerbId('HKCR\\*\\shell', 'edit')
    const c = discoverVerbId('HKCR\\*\\shell', 'print')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a.startsWith('sv-')).toBe(true)
  })
})
