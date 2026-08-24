import { describe, expect, it } from 'vitest'
import {
  classifyClipboard,
  defaultPasteFormat,
  htmlLooksRich,
  isSingleHttpUrl,
  sanitizeFileStem
} from '../shared/schemas/clipboardPaste'

describe('clipboard paste classify (D56)', () => {
  it('detects a single http(s) URL', () => {
    expect(isSingleHttpUrl('https://example.com/a')).toBe(true)
    expect(isSingleHttpUrl('http://localhost:3000')).toBe(true)
    expect(isSingleHttpUrl('ftp://x')).toBe(false)
    expect(isSingleHttpUrl('https://a.com\nhttps://b.com')).toBe(false)
    expect(isSingleHttpUrl('not a url')).toBe(false)
  })

  it('treats browser-wrapped plain text as not rich HTML', () => {
    expect(htmlLooksRich('<html><body>hello</body></html>', 'hello')).toBe(false)
    expect(htmlLooksRich('<table><tr><td>x</td></tr></table>', 'x')).toBe(true)
  })

  it('prefers files, then image, then URL, then rich HTML, then text', () => {
    expect(classifyClipboard({ hasFiles: true, hasImage: true, text: 'https://a.com', html: '' })).toBe(
      'files'
    )
    expect(classifyClipboard({ hasFiles: false, hasImage: true, text: 'https://a.com', html: '' })).toBe(
      'image'
    )
    expect(classifyClipboard({ hasFiles: false, hasImage: false, text: 'https://a.com', html: '<a>' })).toBe(
      'url'
    )
    expect(
      classifyClipboard({
        hasFiles: false,
        hasImage: false,
        text: 'hi',
        html: '<table><tr><td>hi</td></tr></table>'
      })
    ).toBe('html')
    expect(classifyClipboard({ hasFiles: false, hasImage: false, text: 'hello', html: '<p>hello</p>' })).toBe(
      'text'
    )
    expect(classifyClipboard({ hasFiles: false, hasImage: false, text: '', html: '' })).toBe('empty')
  })

  it('maps kinds to default formats', () => {
    expect(defaultPasteFormat('image')).toBe('png')
    expect(defaultPasteFormat('url')).toBe('url')
    expect(defaultPasteFormat('html')).toBe('html')
    expect(defaultPasteFormat('text')).toBe('txt')
    expect(defaultPasteFormat('files')).toBeNull()
  })

  it('sanitizes stems', () => {
    expect(sanitizeFileStem('foo:bar*.txt')).toBe('foo_bar_.txt')
    expect(sanitizeFileStem('   ')).toBe('Clipboard')
  })
})
