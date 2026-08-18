import { describe, expect, it } from 'vitest'
import { windowsToolIdSchema } from '../shared/schemas/windowsTools'
import { windowsSystem32File } from '../main/shell/windowsTools'

describe('windows tools', () => {
  it('accepts the allowlisted This PC / MMC ids', () => {
    expect(windowsToolIdSchema.parse('computer-manager')).toBe('computer-manager')
    expect(windowsToolIdSchema.parse('device-manager')).toBe('device-manager')
    expect(windowsToolIdSchema.parse('control-panel')).toBe('control-panel')
    expect(windowsToolIdSchema.parse('this-pc-properties')).toBe('this-pc-properties')
    expect(() => windowsToolIdSchema.parse('cmd.exe')).toThrow()
  })

  it('resolves MMC snap-ins under System32', () => {
    expect(windowsSystem32File('compmgmt.msc').toLowerCase()).toMatch(/system32[\\/]compmgmt\.msc$/)
    expect(windowsSystem32File('devmgmt.msc').toLowerCase()).toMatch(/system32[\\/]devmgmt\.msc$/)
    expect(windowsSystem32File('control.exe').toLowerCase()).toMatch(/system32[\\/]control\.exe$/)
  })
})
