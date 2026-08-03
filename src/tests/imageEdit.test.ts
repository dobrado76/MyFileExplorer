import { describe, expect, it } from 'vitest'
import { isEditableImagePath, sharpFormatForExt } from '../shared/imageEdit'

describe('imageEdit helpers', () => {
  it('allows common raster formats', () => {
    expect(isEditableImagePath('C:\\a\\photo.jpg')).toBe(true)
    expect(isEditableImagePath('C:\\a\\photo.PNG')).toBe(true)
    expect(isEditableImagePath('C:\\a\\photo.webp')).toBe(true)
  })

  it('rejects svg/psd/non-images', () => {
    expect(isEditableImagePath('C:\\a\\icon.svg')).toBe(false)
    expect(isEditableImagePath('C:\\a\\file.psd')).toBe(false)
    expect(isEditableImagePath('C:\\a\\doc.txt')).toBe(false)
  })

  it('maps extensions to sharp formats', () => {
    expect(sharpFormatForExt('jpg')).toBe('jpeg')
    expect(sharpFormatForExt('bmp')).toBe('jpeg')
    expect(sharpFormatForExt('png')).toBe('png')
    expect(sharpFormatForExt('svg')).toBe(null)
  })
})
