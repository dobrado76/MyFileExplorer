import { describe, expect, it } from 'vitest'
import { displayFileName, normalizeHideNameExtensions } from '../shared/hideNameExtensions'
import { settingsSchema } from '../shared/schemas/settings'

describe('hideNameExtensions', () => {
  it('normalizes dots, case, and duplicates', () => {
    expect(normalizeHideNameExtensions(['.LNK', 'lnk', ' URL ', ''])).toEqual(['lnk', 'url'])
  })

  it('strips only listed trailing extensions', () => {
    expect(displayFileName('Shortcut.lnk', ['lnk'])).toBe('Shortcut')
    expect(displayFileName('photo.jpg', ['lnk'])).toBe('photo.jpg')
    expect(displayFileName('a.b.lnk', ['lnk'])).toBe('a.b')
    expect(displayFileName('.lnk', ['lnk'])).toBe('.lnk')
  })

  it('defaults settings to hide lnk', () => {
    expect(settingsSchema.parse({}).hideNameExtensions).toEqual(['lnk'])
  })
})
