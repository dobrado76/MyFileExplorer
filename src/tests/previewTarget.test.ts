import { describe, expect, it } from 'vitest'
import { resolvePreviewTargetPath } from '../shared/previewTarget'

describe('resolvePreviewTargetPath', () => {
  it('returns null when nothing is selected', () => {
    expect(resolvePreviewTargetPath([], 'C:\\a.txt')).toBeNull()
  })

  it('uses focused path when it is in the selection', () => {
    expect(
      resolvePreviewTargetPath(['C:\\a.txt', 'C:\\b.txt'], 'C:\\a.txt')
    ).toBe('C:\\a.txt')
  })

  it('falls back to the last selected path when focus is outside the selection', () => {
    expect(
      resolvePreviewTargetPath(['C:\\a.txt', 'C:\\b.txt'], 'C:\\other.txt')
    ).toBe('C:\\b.txt')
  })

  it('treats drive-letter case as the same path', () => {
    expect(resolvePreviewTargetPath(['c:\\a.txt'], 'C:\\a.txt')).toBe('C:\\a.txt')
  })
})
