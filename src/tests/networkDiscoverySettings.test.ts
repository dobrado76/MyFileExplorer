import { describe, expect, it } from 'vitest'
import {
  defaultSettings,
  settingsSchema,
  NETWORK_DISCOVERY_INTERVAL_DEFAULT_MINUTES,
  NETWORK_DISCOVERY_INTERVAL_MAX_MINUTES,
  NETWORK_DISCOVERY_INTERVAL_MIN_MINUTES,
  networkDiscoveryIntervalMs
} from '../shared/schemas/settings'
import {
  defaultNetworkDiscoverySettings,
  networkDiscoverySettingsSchema
} from '../shared/schemas/networkDiscovery'

describe('networkDiscovery settings', () => {
  it('defaults to enabled, auto every 5 minutes with local computer hidden', () => {
    expect(settingsSchema.parse({}).networkDiscovery).toEqual(defaultNetworkDiscoverySettings)
    expect(defaultSettings.networkDiscovery.enabled).toBe(true)
    expect(defaultSettings.networkDiscovery.mode).toBe('auto')
    expect(defaultSettings.networkDiscovery.intervalMinutes).toBe(
      NETWORK_DISCOVERY_INTERVAL_DEFAULT_MINUTES
    )
    expect(defaultSettings.networkDiscovery.showLocalComputer).toBe(false)
    expect(networkDiscoveryIntervalMs(defaultSettings.networkDiscovery)).toBe(5 * 60_000)
  })

  it('clamps interval and accepts manual mode', () => {
    expect(networkDiscoverySettingsSchema.parse({ mode: 'manual', intervalMinutes: 0 })).toEqual({
      enabled: true,
      mode: 'manual',
      intervalMinutes: NETWORK_DISCOVERY_INTERVAL_MIN_MINUTES,
      showLocalComputer: false
    })
    expect(
      networkDiscoverySettingsSchema.parse({ mode: 'auto', intervalMinutes: 999 }).intervalMinutes
    ).toBe(NETWORK_DISCOVERY_INTERVAL_MAX_MINUTES)
  })

  it('merges partial networkDiscovery into settings', () => {
    const parsed = settingsSchema.parse({
      ...defaultSettings,
      networkDiscovery: { mode: 'manual' }
    })
    expect(parsed.networkDiscovery).toEqual({
      enabled: true,
      mode: 'manual',
      intervalMinutes: NETWORK_DISCOVERY_INTERVAL_DEFAULT_MINUTES,
      showLocalComputer: false
    })
  })

  it('accepts enabled false and showLocalComputer true', () => {
    expect(
      networkDiscoverySettingsSchema.parse({
        enabled: false,
        mode: 'auto',
        intervalMinutes: 5,
        showLocalComputer: true
      })
    ).toEqual({
      enabled: false,
      mode: 'auto',
      intervalMinutes: 5,
      showLocalComputer: true
    })
  })
})
