import { describe, expect, it } from 'vitest'
import { pdfPreviewSrc } from '../renderer/lib/pdfPreview'

describe('pdfPreviewSrc', () => {
  it('appends navpanes=0 and zoom=100', () => {
    expect(pdfPreviewSrc('mfe-media://local/C:/doc.pdf')).toBe(
      'mfe-media://local/C:/doc.pdf#navpanes=0&zoom=100'
    )
  })

  it('replaces an existing hash', () => {
    expect(pdfPreviewSrc('mfe-media://local/C:/doc.pdf#page=3')).toBe(
      'mfe-media://local/C:/doc.pdf#navpanes=0&zoom=100'
    )
  })
})
