import { describe, expect, it } from 'vitest'
import { devCfgMatchesComputerName, isDevCfgOpen, parseDevCfg } from '../shared/devGate'

describe('parseDevCfg', () => {
  it('parses ENABLE and COMPUTER_NAME', () => {
    expect(
      parseDevCfg(`ENABLE=true\nCOMPUTER_NAME=QUADONYX\n`)
    ).toEqual({ enable: true, computerName: 'QUADONYX' })
  })

  it('returns null when ENABLE or COMPUTER_NAME missing', () => {
    expect(parseDevCfg('ENABLE=true\n')).toBeNull()
    expect(parseDevCfg('COMPUTER_NAME=QUADONYX\n')).toBeNull()
  })
})

describe('isDevCfgOpen', () => {
  it('requires enable true and matching computer name', () => {
    const cfg = { enable: true, computerName: 'QUADONYX' }
    expect(isDevCfgOpen(cfg, ['QUADONYX', 'quadonyx.local'])).toBe(true)
    expect(isDevCfgOpen(cfg, ['OTHER-PC'])).toBe(false)
    expect(isDevCfgOpen({ ...cfg, enable: false }, ['QUADONYX'])).toBe(false)
  })

  it('matches case-insensitively', () => {
    expect(devCfgMatchesComputerName('quadonyx', ['QUADONYX'])).toBe(true)
  })
})
