import { describe, expect, it } from 'vitest'
import {
  imageEditShouldWrite,
  imageEditorShortcut
} from '../renderer/components/imageEditorShortcuts'

describe('imageEditorShortcut', () => {
  it('maps save, tools, and tabs', () => {
    expect(imageEditorShortcut({ key: 'e' })).toBe('save')
    expect(imageEditorShortcut({ key: 'E' })).toBe('save')
    expect(imageEditorShortcut({ key: 's', ctrlKey: true })).toBe('save')
    expect(imageEditorShortcut({ key: 's', metaKey: true })).toBe('save')
    expect(imageEditorShortcut({ key: 'c' })).toBe('crop')
    expect(imageEditorShortcut({ key: 'r' })).toBe('rotate')
    expect(imageEditorShortcut({ key: 'f' })).toBe('flip-x')
    expect(imageEditorShortcut({ key: 'F', shiftKey: true })).toBe('flip-y')
    expect(imageEditorShortcut({ key: 'o' })).toBe('remove')
    expect(imageEditorShortcut({ key: 'z' })).toBe('resize')
    expect(imageEditorShortcut({ key: 'a' })).toBe('annotate')
    expect(imageEditorShortcut({ key: 't' })).toBe('filters')
    expect(imageEditorShortcut({ key: 'u' })).toBe('finetune')
  })

  it('ignores repeats, extra modifiers, and unrelated keys', () => {
    expect(imageEditorShortcut({ key: 'e', repeat: true })).toBeNull()
    expect(imageEditorShortcut({ key: 'e', ctrlKey: true })).toBeNull()
    expect(imageEditorShortcut({ key: 'e', shiftKey: true })).toBeNull()
    expect(imageEditorShortcut({ key: 's', ctrlKey: true, shiftKey: true })).toBeNull()
    expect(imageEditorShortcut({ key: 's', ctrlKey: true, altKey: true })).toBeNull()
    expect(imageEditorShortcut({ key: 'f', altKey: true })).toBeNull()
    expect(imageEditorShortcut({ key: 'x' })).toBeNull()
    expect(imageEditorShortcut({ key: 'Escape' })).toBeNull()
  })
})

describe('imageEditShouldWrite', () => {
  it('skips a version when the loaded image is unchanged', () => {
    expect(imageEditShouldWrite({ hasUndo: false, bakedFromDisk: false })).toBe(false)
  })

  it('writes after an edit, a bake, or both', () => {
    expect(imageEditShouldWrite({ hasUndo: true, bakedFromDisk: false })).toBe(true)
    expect(imageEditShouldWrite({ hasUndo: false, bakedFromDisk: true })).toBe(true)
    expect(imageEditShouldWrite({ hasUndo: true, bakedFromDisk: true })).toBe(true)
  })
})
