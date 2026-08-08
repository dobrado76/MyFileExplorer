import { describe, expect, it } from 'vitest'
import { shouldUseExtIconCache } from '../main/icons/shell'

describe('shouldUseExtIconCache', () => {
  it('never shares extension cache for directories', () => {
    expect(shouldUseExtIconCache('', true)).toBe(false)
    expect(shouldUseExtIconCache('org', true)).toBe(false)
    expect(shouldUseExtIconCache('png', true)).toBe(false)
  })

  it('allows typed file extensions', () => {
    expect(shouldUseExtIconCache('png', false)).toBe(true)
    expect(shouldUseExtIconCache('png', undefined)).toBe(true)
  })

  it('only caches extensionless names when known to be files', () => {
    expect(shouldUseExtIconCache('', false)).toBe(true)
    expect(shouldUseExtIconCache('', undefined)).toBe(false)
  })

  it('keeps per-file types out of the shared cache', () => {
    expect(shouldUseExtIconCache('exe', false)).toBe(false)
    expect(shouldUseExtIconCache('lnk', undefined)).toBe(false)
  })
})
