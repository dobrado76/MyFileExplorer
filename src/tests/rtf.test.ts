import { describe, expect, it } from 'vitest'
import { rtfToPlainText, rtfToHtml } from '../main/preview/rtf'

describe('rtfToPlainText', () => {
  it('extracts simple body text', () => {
    const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}\f0\fs24 Hello world.\par Second line.}`
    const text = rtfToPlainText(rtf)
    expect(text).toContain('Hello world.')
    expect(text).toContain('Second line.')
    expect(text).not.toContain('rtf1')
    expect(text).not.toContain('fonttbl')
  })

  it('decodes unicode escapes', () => {
    // RTF \uN uses a decimal code point; 8212 = U+2014 em dash.
    const rtf = '{\\rtf1\\ansi Yes\\u8212?no}'
    expect(rtfToPlainText(rtf)).toContain('Yes—no')
  })

  it('builds simple HTML paragraphs', () => {
    const warnings: string[] = []
    const html = rtfToHtml(String.raw`{\rtf1\ansi\deff0 Para one.\par\par Para two.}`, warnings)
    expect(html).toContain('<p>')
    expect(html).toContain('Para one.')
    expect(html).toContain('Para two.')
    expect(warnings).toHaveLength(0)
  })
})
