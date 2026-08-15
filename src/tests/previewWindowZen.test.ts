import { describe, expect, it } from 'vitest'
import {
  defaultSettings,
  settingsPatchSchema,
  settingsSchema
} from '../shared/schemas/settings'

describe('previewWindowZen setting', () => {
  it('defaults to false', () => {
    expect(settingsSchema.parse({}).previewWindowZen).toBe(false)
    expect(defaultSettings.previewWindowZen).toBe(false)
  })

  it('round-trips true through patch + full schema', () => {
    const patch = settingsPatchSchema.parse({ previewWindowZen: true })
    expect(patch).toEqual({ previewWindowZen: true })
    const next = settingsSchema.parse({ ...defaultSettings, ...patch })
    expect(next.previewWindowZen).toBe(true)
  })

  it('preserves true when loading from disk-shaped JSON', () => {
    const loaded = settingsSchema.parse({
      ...defaultSettings,
      previewWindowZen: true
    })
    expect(loaded.previewWindowZen).toBe(true)
  })
})
