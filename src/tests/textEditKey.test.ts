import { describe, expect, it } from 'vitest'
import { nextTextAfterDeleteKey } from '../renderer/lib/textEditKey'

describe('nextTextAfterDeleteKey', () => {
  it('clears a selected filename (rename starts with the name selected)', () => {
    expect(nextTextAfterDeleteKey('Holiday', 0, 7, 'Delete')).toEqual({ value: '', caret: 0 })
    expect(nextTextAfterDeleteKey('Holiday', 0, 7, 'Backspace')).toEqual({ value: '', caret: 0 })
  })

  it('deletes one character when nothing is selected', () => {
    expect(nextTextAfterDeleteKey('Holiday', 3, 3, 'Backspace')).toEqual({
      value: 'Hoiday',
      caret: 2
    })
    expect(nextTextAfterDeleteKey('Holiday', 3, 3, 'Delete')).toEqual({
      value: 'Holday',
      caret: 3
    })
  })

  it('does nothing at the ends', () => {
    expect(nextTextAfterDeleteKey('A', 0, 0, 'Backspace')).toEqual({ value: 'A', caret: 0 })
    expect(nextTextAfterDeleteKey('A', 1, 1, 'Delete')).toEqual({ value: 'A', caret: 1 })
  })
})