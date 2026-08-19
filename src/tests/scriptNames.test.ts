import { describe, expect, it } from 'vitest'
import { scriptNameStem, uniqueScriptName } from '../shared/scriptNames'

describe('uniqueScriptName', () => {
  it('keeps a free name', () => {
    expect(uniqueScriptName('File space report', ['Other'])).toBe('File space report')
  })

  it('adds (2) then (3) like Explorer', () => {
    expect(uniqueScriptName('File space report', ['File space report'])).toBe(
      'File space report (2)'
    )
    expect(
      uniqueScriptName('File space report', ['File space report', 'File space report (2)'])
    ).toBe('File space report (3)')
  })

  it('treats clashes as case-insensitive', () => {
    expect(uniqueScriptName('file space report', ['File Space Report'])).toBe(
      'file space report (2)'
    )
  })

  it('does not send or need the existing list as (2) (2)', () => {
    expect(uniqueScriptName('File space report (2)', ['File space report (2)'])).toBe(
      'File space report (3)'
    )
  })

  it('ignores the current script when it is omitted from taken', () => {
    expect(uniqueScriptName('File space report', ['Other'])).toBe('File space report')
  })
})

describe('scriptNameStem', () => {
  it('strips a trailing copy number', () => {
    expect(scriptNameStem('Report (2)')).toBe('Report')
    expect(scriptNameStem('Report')).toBe('Report')
  })
})
