import { z } from 'zod'

/** Settings → Network auto rediscovery interval (minutes). */
export const NETWORK_DISCOVERY_INTERVAL_MIN_MINUTES = 1
export const NETWORK_DISCOVERY_INTERVAL_MAX_MINUTES = 60
export const NETWORK_DISCOVERY_INTERVAL_DEFAULT_MINUTES = 5

export const networkDiscoveryModeSchema = z.enum(['auto', 'manual'])
export type NetworkDiscoveryMode = z.infer<typeof networkDiscoveryModeSchema>

function clampIntervalMinutes(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return NETWORK_DISCOVERY_INTERVAL_DEFAULT_MINUTES
  return Math.min(
    NETWORK_DISCOVERY_INTERVAL_MAX_MINUTES,
    Math.max(NETWORK_DISCOVERY_INTERVAL_MIN_MINUTES, Math.round(v))
  )
}

export const networkDiscoverySettingsSchema = z.object({
  /**
   * Master switch. When false, no discovery runs (boot / F5 / timer / Discover now)
   * and the tree Network section stays empty — for diagnosing freezes vs LAN work.
   */
  enabled: z.boolean().catch(true),
  /**
   * `auto` — rediscover on a timer after boot.
   * `manual` — only on launch + F5 / Refresh Network.
   */
  mode: networkDiscoveryModeSchema.catch('auto'),
  /** Minutes between background rediscovery passes when `mode` is `auto`. */
  intervalMinutes: z.preprocess(
    clampIntervalMinutes,
    z
      .number()
      .int()
      .min(NETWORK_DISCOVERY_INTERVAL_MIN_MINUTES)
      .max(NETWORK_DISCOVERY_INTERVAL_MAX_MINUTES)
  ),
  /**
   * When true, include this PC under the tree Network section (if discovery finds it).
   * Default false — only other computers.
   */
  showLocalComputer: z.boolean().catch(false)
})

export type NetworkDiscoverySettings = z.infer<typeof networkDiscoverySettingsSchema>

export const defaultNetworkDiscoverySettings: NetworkDiscoverySettings =
  networkDiscoverySettingsSchema.parse({
    enabled: true,
    mode: 'auto',
    intervalMinutes: NETWORK_DISCOVERY_INTERVAL_DEFAULT_MINUTES,
    showLocalComputer: false
  })

/** Interval in ms for the renderer poller. */
export function networkDiscoveryIntervalMs(settings: NetworkDiscoverySettings): number {
  return clampIntervalMinutes(settings.intervalMinutes) * 60_000
}
