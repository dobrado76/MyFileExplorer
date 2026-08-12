import { z } from 'zod'

/** Settings → Remote repositories master switch (D46). */
export const remoteReposSettingsSchema = z.object({
  /**
   * When false: no remote toolbar, no tree section, connection IPC may still
   * persist data but Connect/list should refuse until enabled.
   */
  enabled: z.boolean().catch(false)
})

export type RemoteReposSettings = z.infer<typeof remoteReposSettingsSchema>

export const defaultRemoteReposSettings: RemoteReposSettings =
  remoteReposSettingsSchema.parse({ enabled: false })
