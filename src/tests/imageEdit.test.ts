import { describe, expect, it } from 'vitest'
import {
  IMAGE_VER_MAX,
  IMAGE_VER_COUNT_STREAM,
  isEditableImagePath,
  isImageVersionStreamName,
  parseVerCount,
  renumberAfterDrop,
  renumberAfterShiftOldest,
  sharpFormatForExt,
  verStreamName
} from '../shared/imageEdit'

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

  it('names version streams', () => {
    expect(verStreamName(1)).toBe('VER_1')
    expect(verStreamName(4)).toBe('VER_4')
    expect(IMAGE_VER_MAX).toBe(4)
    expect(IMAGE_VER_COUNT_STREAM).toBe('VER_COUNT')
  })

  it('detects version stream names', () => {
    expect(isImageVersionStreamName('VER_COUNT')).toBe(true)
    expect(isImageVersionStreamName('ver_count')).toBe(true)
    expect(isImageVersionStreamName('VER_1')).toBe(true)
    expect(isImageVersionStreamName('VER_12')).toBe(true)
    expect(isImageVersionStreamName('Zone.Identifier')).toBe(false)
    expect(isImageVersionStreamName('Index')).toBe(false)
  })

  it('parses VER_COUNT text', () => {
    expect(parseVerCount('3')).toBe(3)
    expect(parseVerCount(' 2\0\r\n')).toBe(2)
    expect(parseVerCount('0')).toBe(0)
    expect(parseVerCount('99')).toBe(IMAGE_VER_MAX)
    expect(parseVerCount('nope')).toBe(0)
  })

  it('renumbers after drop', () => {
    const { newCount, map } = renumberAfterDrop(3, 2)
    expect(newCount).toBe(2)
    expect(map.get(1)).toBe(1)
    expect(map.has(2)).toBe(false)
    expect(map.get(3)).toBe(2)
  })

  it('renumbers after dropping tip', () => {
    const { newCount, map } = renumberAfterDrop(3, 3)
    expect(newCount).toBe(2)
    expect([...map.entries()]).toEqual([
      [1, 1],
      [2, 2]
    ])
  })

  it('shifts oldest when at max', () => {
    const { newCount, map } = renumberAfterShiftOldest(IMAGE_VER_MAX)
    expect(newCount).toBe(IMAGE_VER_MAX - 1)
    expect(map.has(1)).toBe(false)
    expect(map.get(2)).toBe(1)
    expect(map.get(4)).toBe(3)
  })

  it('does not shift when under max', () => {
    const { newCount, map } = renumberAfterShiftOldest(2)
    expect(newCount).toBe(2)
    expect(map.get(1)).toBe(1)
    expect(map.get(2)).toBe(2)
  })
})
