import { describe, expect, it } from 'vitest'
import {
  defaultSettings,
  settingsPatchSchema,
  settingsSchema
} from '../shared/schemas/settings'

describe('previewRichPlayerMpv setting', () => {
  it('defaults to false', () => {
    expect(settingsSchema.parse({}).previewRichPlayerMpv).toBe(false)
    expect(defaultSettings.previewRichPlayerMpv).toBe(false)
  })

  it('round-trips true through patch + full schema', () => {
    const patch = settingsPatchSchema.parse({ previewRichPlayerMpv: true })
    expect(patch).toEqual({ previewRichPlayerMpv: true })
    const next = settingsSchema.parse({ ...defaultSettings, ...patch })
    expect(next.previewRichPlayerMpv).toBe(true)
  })

  it('preserves true when loading from disk-shaped JSON', () => {
    const loaded = settingsSchema.parse({
      ...defaultSettings,
      previewRichPlayerMpv: true
    })
    expect(loaded.previewRichPlayerMpv).toBe(true)
  })
})
