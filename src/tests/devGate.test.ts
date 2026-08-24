import { describe, expect, it } from 'vitest'
import {
  applyDevCfgEnable,
  devCfgMatchesComputerName,
  isDevCfgOpen,
  parseDevCfg,
  parseDevCfgEnable
} from '../shared/devGate'

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

describe('parseDevCfgEnable', () => {
  it('reads ENABLE without requiring COMPUTER_NAME', () => {
    expect(parseDevCfgEnable('ENABLE=true\n')).toBe(true)
    expect(parseDevCfgEnable('ENABLE=false\nCOMPUTER_NAME=X\n')).toBe(false)
    expect(parseDevCfgEnable('COMPUTER_NAME=X\n')).toBe(false)
  })
})

describe('applyDevCfgEnable', () => {
  it('replaces an existing ENABLE line and keeps COMPUTER_NAME', () => {
    expect(applyDevCfgEnable('ENABLE=true\nCOMPUTER_NAME=QUADONYX\n', false)).toBe(
      'ENABLE=false\nCOMPUTER_NAME=QUADONYX\n'
    )
  })

  it('inserts ENABLE when missing', () => {
    expect(applyDevCfgEnable('COMPUTER_NAME=QUADONYX\n', true)).toBe(
      'ENABLE=true\nCOMPUTER_NAME=QUADONYX\n'
    )
  })
})
