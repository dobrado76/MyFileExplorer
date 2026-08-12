import { describe, expect, it } from 'vitest'
import { isWindowsBatchFile, quoteWindowsCmdArg } from '../shared/shellExec'

describe('shellExec helpers', () => {
  it('detects bat/cmd', () => {
    expect(isWindowsBatchFile('C:\\tools\\run.bat')).toBe(true)
    expect(isWindowsBatchFile('D:\\x.CMD')).toBe(true)
    expect(isWindowsBatchFile('C:\\tools\\app.exe')).toBe(false)
  })

  it('quotes args with spaces for cmd.exe', () => {
    expect(quoteWindowsCmdArg('C:\\Program Files\\run.bat')).toBe(
      '"C:\\Program Files\\run.bat"'
    )
    expect(quoteWindowsCmdArg('plain')).toBe('plain')
    expect(quoteWindowsCmdArg('')).toBe('""')
  })
})
