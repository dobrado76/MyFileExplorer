import { describe, expect, it } from 'vitest'
import {
  defaultSettings,
  settingsPatchSchema,
  settingsSchema
} from '../shared/schemas/settings'

describe('previewVideoAutoplay setting', () => {
  it('defaults to false', () => {
    expect(settingsSchema.parse({}).previewVideoAutoplay).toBe(false)
    expect(defaultSettings.previewVideoAutoplay).toBe(false)
  })

  it('round-trips true through patch + full schema', () => {
    const patch = settingsPatchSchema.parse({ previewVideoAutoplay: true })
    expect(patch).toEqual({ previewVideoAutoplay: true })
    const next = settingsSchema.parse({ ...defaultSettings, ...patch })
    expect(next.previewVideoAutoplay).toBe(true)
  })

  it('preserves true when loading from disk-shaped JSON', () => {
    const loaded = settingsSchema.parse({
      ...defaultSettings,
      previewVideoAutoplay: true
    })
    expect(loaded.previewVideoAutoplay).toBe(true)
  })
})
