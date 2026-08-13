import { describe, expect, it } from 'vitest'
import {
  captionAccentFromStream,
  captionFillCss,
  hashCaptionSeed,
  parseCaptionAds
} from '@shared/slideshow/captionAds'

describe('parseCaptionAds', () => {
  it('parses an array of caption objects', () => {
    const raw = JSON.stringify([
      {
        Caption: 'Title above the image',
        Descriptor: 'VIEW',
        Sentence: 'A sight or prospect.'
      },
      {
        Caption: 'Other',
        Descriptor: 'TEMPT',
        Sentence: 'Entice someone.'
      }
    ])
    const rows = parseCaptionAds(raw)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.caption).toBe('Title above the image')
    expect(rows[0]?.descriptor).toBe('VIEW')
    expect(rows[1]?.descriptor).toBe('TEMPT')
  })

  it('accepts a single object and BOM', () => {
    const rows = parseCaptionAds(
      `\uFEFF${JSON.stringify({ Caption: 'A', Descriptor: 'B', Sentence: 'C' })}`
    )
    expect(rows).toEqual([{ caption: 'A', descriptor: 'B', sentence: 'C' }])
  })

  it('returns empty for invalid JSON', () => {
    expect(parseCaptionAds('not json')).toEqual([])
    expect(parseCaptionAds('')).toEqual([])
  })
})

describe('captionAccentFromStream', () => {
  const stream = JSON.stringify([
    { Caption: 'Title A', Descriptor: 'VIEW', Sentence: 'One.' },
    { Caption: 'Title B', Descriptor: 'TEMPT', Sentence: 'Two.' }
  ])

  it('is stable for the same Caption ADS stream', () => {
    expect(captionAccentFromStream(stream)).toBe(captionAccentFromStream(stream))
  })

  it('does not depend on which array entry would be picked', () => {
    const onlyFirst = JSON.stringify([
      { Caption: 'Title A', Descriptor: 'VIEW', Sentence: 'One.' }
    ])
    expect(captionAccentFromStream(stream)).not.toBe(captionAccentFromStream(onlyFirst))
    expect(captionFillCss('Title A')).not.toBe(captionAccentFromStream(stream))
    expect(captionFillCss('Title B')).not.toBe(captionAccentFromStream(stream))
  })

  it('differs for different streams', () => {
    const other = JSON.stringify([{ Caption: 'Other', Descriptor: 'X', Sentence: 'Y' }])
    expect(captionAccentFromStream(stream)).not.toBe(captionAccentFromStream(other))
  })

  it('uses comma hsl for canvas compatibility', () => {
    expect(captionAccentFromStream(stream)).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
  })
})

describe('captionFillCss', () => {
  it('is stable for the same caption string', () => {
    expect(captionFillCss('VIEW')).toBe(captionFillCss('VIEW'))
    expect(hashCaptionSeed('VIEW')).toBe(hashCaptionSeed('VIEW'))
    expect(captionFillCss('')).toBe(captionFillCss(''))
  })

  it('differs for different captions', () => {
    expect(captionFillCss('VIEW')).not.toBe(captionFillCss('TEMPT'))
  })

  it('uses comma hsl for canvas compatibility', () => {
    expect(captionFillCss('VIEW')).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
  })
})
