import { describe, expect, it } from 'vitest'
import {
  codeToKeyToken,
  keyTokenToCode,
  normalizeKeyToken
} from '../shared/slideshow/keys'
import { parseCategorizerMap, serializeCategorizerMap } from '../shared/slideshow/categorizerMap'

describe('Forms.Keys mapping', () => {
  it('maps Back / OemMinus / Oemplus / letters like .NET Keys', () => {
    expect(normalizeKeyToken('Back')).toBe('Back')
    expect(normalizeKeyToken('Keys.Back')).toBe('Back')
    expect(normalizeKeyToken('Backspace')).toBe('Back')
    expect(keyTokenToCode('Back')).toBe('Backspace')
    expect(keyTokenToCode('OemMinus')).toBe('Minus')
    expect(keyTokenToCode('Oemplus')).toBe('Equal')
    expect(keyTokenToCode('Keys.Oemplus')).toBe('Equal')
    expect(keyTokenToCode('O')).toBe('KeyO')
    expect(keyTokenToCode('D5')).toBe('Digit5')
    expect(keyTokenToCode('F12')).toBe('F12')
  })

  it('round-trips KeyboardEvent.code ↔ Forms token', () => {
    expect(codeToKeyToken('Minus')).toBe('OemMinus')
    expect(codeToKeyToken('Equal')).toBe('Oemplus')
    expect(codeToKeyToken('Backspace')).toBe('Back')
    expect(codeToKeyToken('KeyO')).toBe('O')
    expect(codeToKeyToken('Comma')).toBe('Oemcomma')
    expect(codeToKeyToken('Numpad1')).toBeNull()
    expect(codeToKeyToken('Tab')).toBeNull() // reserved: slideshow Edit image
  })

  it('parses and saves Oem keys in map files', () => {
    const text = `"Shrink", Keys.OemMinus, "C:\\\\a\\\\"
"Grow", Keys.Oemplus, "C:\\\\b\\\\"
"Del", Keys.Back, ""
`
    const rows = parseCategorizerMap(text)
    expect(rows.map((r) => r.keyToken)).toEqual(['OemMinus', 'Oemplus', 'Back'])
    const out = serializeCategorizerMap(rows)
    expect(out).toContain('Keys.OemMinus')
    expect(out).toContain('Keys.Oemplus')
    expect(out).toContain('Keys.Back')
  })
})
