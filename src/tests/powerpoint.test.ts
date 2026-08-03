import { describe, expect, it } from 'vitest'
import {
  extractPptBinaryTexts,
  extractPptxSlideParagraphs
} from '../main/preview/powerpoint'

describe('extractPptxSlideParagraphs', () => {
  it('joins text runs inside a paragraph', () => {
    const xml = `
      <p:sld>
        <a:p><a:r><a:t>Hello</a:t></a:r><a:r><a:t> world</a:t></a:r></a:p>
        <a:p><a:r><a:t>Second</a:t></a:r></a:p>
      </p:sld>`
    expect(extractPptxSlideParagraphs(xml)).toEqual(['Hello world', 'Second'])
  })

  it('decodes XML entities', () => {
    const xml = `<a:p><a:r><a:t>A &amp; B</a:t></a:r></a:p>`
    expect(extractPptxSlideParagraphs(xml)).toEqual(['A & B'])
  })
})

describe('extractPptBinaryTexts', () => {
  it('finds UTF-16LE strings', () => {
    const text = 'Agenda Overview'
    const u16 = Buffer.alloc(text.length * 2)
    for (let i = 0; i < text.length; i++) u16.writeUInt16LE(text.charCodeAt(i), i * 2)
    const buf = Buffer.concat([Buffer.alloc(4), u16, Buffer.alloc(2)])
    expect(extractPptBinaryTexts(buf)).toContain('Agenda Overview')
  })
})
