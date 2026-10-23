import { describe, expect, it } from 'vitest'
import {
  annotationEditorClaimsKey,
  editorShortcutSupersedesTyping,
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

describe('editorShortcutSupersedesTyping', () => {
  it('lets annotation text receive letter keys, including E', () => {
    expect(editorShortcutSupersedesTyping('save', { key: 'e' })).toBe(false)
    expect(editorShortcutSupersedesTyping('annotate', { key: 'a' })).toBe(false)
    expect(editorShortcutSupersedesTyping('save', { key: 's', ctrlKey: true })).toBe(true)
    expect(editorShortcutSupersedesTyping('save', { key: 's', metaKey: true })).toBe(true)
  })
})

describe('annotationEditorClaimsKey', () => {
  it('takes keys that are still aimed at the canvas', () => {
    expect(
      annotationEditorClaimsKey({
        editorOpen: true,
        targetIsEditor: false,
        targetIsTyping: false
      })
    ).toBe(true)
  })

  it('leaves the text box and sidebar fields alone', () => {
    expect(
      annotationEditorClaimsKey({
        editorOpen: true,
        targetIsEditor: true,
        targetIsTyping: true
      })
    ).toBe(false)
    expect(
      annotationEditorClaimsKey({
        editorOpen: true,
        targetIsEditor: false,
        targetIsTyping: true
      })
    ).toBe(false)
    expect(
      annotationEditorClaimsKey({
        editorOpen: false,
        targetIsEditor: false,
        targetIsTyping: false
      })
    ).toBe(false)
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
