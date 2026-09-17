import { describe, expect, it } from 'vitest'
import { FONT_FAMILY_OPTIONS, fontFamilySelectOptions } from '../shared/schemas/settings'

describe('fontFamilySelectOptions', () => {
  it('lists curated fonts with Segoe UI present', () => {
    const opts = fontFamilySelectOptions('Segoe UI')
    expect(opts[0]).toBe('Segoe UI')
    expect(opts).toEqual([...FONT_FAMILY_OPTIONS])
  })

  it('keeps an unknown current family at the top without duplicating', () => {
    const opts = fontFamilySelectOptions('My Custom Font')
    expect(opts[0]).toBe('My Custom Font')
    expect(opts.filter((n) => n.toLowerCase() === 'segoe ui')).toHaveLength(1)
    expect(opts).toContain('Consolas')
  })
})
