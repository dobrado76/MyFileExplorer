import { describe, expect, it } from 'vitest'
import { psSingleQuote, windowStyleLabel } from '../main/preview/lnk'

describe('lnk helpers', () => {
  it('escapes single quotes for PowerShell', () => {
    expect(psSingleQuote(`C:\\foo`)).toBe(`'C:\\foo'`)
    expect(psSingleQuote(`C:\\o'brian`)).toBe(`'C:\\o''brian'`)
  })

  it('labels window styles', () => {
    expect(windowStyleLabel(1)).toBe('Normal')
    expect(windowStyleLabel(3)).toBe('Maximized')
    expect(windowStyleLabel(7)).toBe('Minimized')
  })
})
