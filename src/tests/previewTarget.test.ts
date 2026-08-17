import { describe, expect, it } from 'vitest'
import { resolvePreviewTargetPath } from '../shared/previewTarget'

describe('resolvePreviewTargetPath', () => {
  it('returns null when nothing is selected and there is no folder', () => {
    expect(resolvePreviewTargetPath([], 'C:\\a.txt')).toBeNull()
  })

  it('previews the current folder when nothing is selected', () => {
    expect(resolvePreviewTargetPath([], null, 'E:\\Series\\7 Days')).toBe('E:\\Series\\7 Days')
  })

  it('prefers a selected file over the current folder', () => {
    expect(
      resolvePreviewTargetPath(['E:\\Series\\7 Days\\S01E01.mkv'], null, 'E:\\Series\\7 Days')
    ).toBe('E:\\Series\\7 Days\\S01E01.mkv')
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
