import { describe, expect, it } from 'vitest'
import {
  classifyGenModelFamily,
  genModelFamilyAllowed
} from '../shared/genModelFamily'

describe('classifyGenModelFamily', () => {
  it('detects Krea', () => {
    expect(classifyGenModelFamily('kreaRealtime_v2')).toBe('krea')
    expect(classifyGenModelFamily('Krea 2')).toBe('krea')
  })

  it('detects SDXL / Pony / Illustrious', () => {
    expect(classifyGenModelFamily('ponyDiffusionV6XL')).toBe('sdxl')
    expect(classifyGenModelFamily('waiIllustriousSDXL_v140')).toBe('sdxl')
    expect(classifyGenModelFamily('sd_xl_base_1.0')).toBe('sdxl')
    expect(classifyGenModelFamily('juggernautXL_v9')).toBe('sdxl')
  })

  it('detects SD 1.5', () => {
    expect(classifyGenModelFamily('dreamshaper_8')).toBe('sd15')
    expect(classifyGenModelFamily('v1-5-pruned-emaonly')).toBe('sd15')
    expect(classifyGenModelFamily('realisticVisionV51')).toBe('sd15')
  })

  it('uses Size when name is ambiguous', () => {
    expect(classifyGenModelFamily('myCheckpoint', { size: '512x768' })).toBe('sd15')
    expect(classifyGenModelFamily('myCheckpoint', { size: '1024x1024' })).toBe('sdxl')
  })

  it('returns null for empty model', () => {
    expect(classifyGenModelFamily('')).toBeNull()
    expect(classifyGenModelFamily(null)).toBeNull()
  })

  it('allowlist keeps untagged and matching families', () => {
    expect(genModelFamilyAllowed(null, ['krea', 'sdxl'])).toBe(true)
    expect(genModelFamilyAllowed('ponyDiffusionV6XL', ['krea', 'sdxl'])).toBe(true)
    expect(genModelFamilyAllowed('dreamshaper_8', ['krea', 'sdxl'])).toBe(false)
    expect(genModelFamilyAllowed('krea_v2', ['krea', 'sdxl'])).toBe(true)
  })
})
