import { describe, expect, it } from 'vitest'
import { buildSearchQuery, defaultPowerSearchState } from '@shared/searchBuilder'

describe('buildSearchQuery', () => {
  it('combines terms, macros, and filters', () => {
    const q = buildSearchQuery({
      ...defaultPowerSearchState(),
      terms: 'vacation photos',
      types: ['pic'],
      dateModified: 'thisweek',
      sizePreset: 'custom',
      sizeCustom: '>5mb',
      inFolder: 'Trips\\2024'
    })
    expect(q).toContain('pic:')
    expect(q).toContain('vacation')
    expect(q).toContain('photos')
    expect(q).toContain('dm:thisweek')
    expect(q).toContain('size:>5mb')
    expect(q).toContain('infolder:')
  })

  it('adds exclude tokens', () => {
    const q = buildSearchQuery({
      ...defaultPowerSearchState(),
      exclude: 'tmp backup'
    })
    expect(q).toContain('!tmp')
    expect(q).toContain('!backup')
  })
})
