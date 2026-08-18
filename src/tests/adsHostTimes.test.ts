import { describe, expect, it } from 'vitest'
import { fileTimeToUnixMs } from '../main/fs/adsWin32'

describe('FILETIME → Unix ms', () => {
  it('maps the Unix epoch to 0', () => {
    expect(fileTimeToUnixMs(116444736000000000n)).toBe(0)
  })

  it('maps one second after the Unix epoch to 1000 ms', () => {
    expect(fileTimeToUnixMs(116444736000000000n + 10_000_000n)).toBe(1000)
  })
})
