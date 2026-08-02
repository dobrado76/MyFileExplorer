import { describe, it, expect } from 'vitest'
import { parseA1111Parameters, parseSettingsPairs } from '../main/preview/a1111'

const FULL = `masterpiece, best quality, a cat sitting on a windowsill
Negative prompt: lowres, bad anatomy, blurry
Steps: 28, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 1234567890, Size: 512x768, Model hash: abc123def, Model: dreamshaper_8`

describe('parseA1111Parameters', () => {
  it('parses prompt, negative and settings', () => {
    const p = parseA1111Parameters(FULL)
    expect(p).not.toBeNull()
    expect(p!.prompt).toBe('masterpiece, best quality, a cat sitting on a windowsill')
    expect(p!.negative).toBe('lowres, bad anatomy, blurry')
    expect(p!.settings['Steps']).toBe('28')
    expect(p!.settings['Sampler']).toBe('DPM++ 2M Karras')
    expect(p!.settings['CFG scale']).toBe('7')
    expect(p!.settings['Seed']).toBe('1234567890')
    expect(p!.settings['Size']).toBe('512x768')
    expect(p!.settings['Model']).toBe('dreamshaper_8')
    expect(p!.settings['Model hash']).toBe('abc123def')
  })

  it('parses without negative prompt', () => {
    const p = parseA1111Parameters('a dog\nSteps: 20, Sampler: Euler a, Seed: 42')
    expect(p).not.toBeNull()
    expect(p!.prompt).toBe('a dog')
    expect(p!.negative).toBeNull()
    expect(p!.settings['Sampler']).toBe('Euler a')
  })

  it('handles multiline prompts and negatives', () => {
    const text = `line one,
line two
Negative prompt: bad,
worse
Steps: 10, Sampler: Euler`
    const p = parseA1111Parameters(text)
    expect(p!.prompt).toBe('line one,\nline two')
    expect(p!.negative).toBe('bad,\nworse')
  })

  it('returns null for plain text', () => {
    expect(parseA1111Parameters('just a regular comment')).toBeNull()
    expect(parseA1111Parameters('')).toBeNull()
  })

  it('keeps raw text', () => {
    const p = parseA1111Parameters(FULL)
    expect(p!.raw).toContain('Steps: 28')
  })

  it('handles quoted values with commas', () => {
    const p = parseA1111Parameters('x\nSteps: 5, Lora hashes: "a: 1, b: 2", Model: m')
    expect(p!.settings['Lora hashes']).toBe('a: 1, b: 2')
    expect(p!.settings['Model']).toBe('m')
  })
})

describe('parseSettingsPairs', () => {
  it('parses empty input', () => {
    expect(parseSettingsPairs('')).toEqual({})
  })
  it('parses simple pairs', () => {
    expect(parseSettingsPairs('Steps: 20, CFG scale: 7.5')).toEqual({
      Steps: '20',
      'CFG scale': '7.5'
    })
  })
})
