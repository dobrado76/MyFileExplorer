import { describe, expect, it } from 'vitest'
import {
  pathsAfterRedo,
  pathsAfterUndo,
  pushCapped,
  redoActionTitle,
  undoActionTitle,
  type UndoEntry
} from '../renderer/lib/undoHistory'

describe('undoHistory', () => {
  it('caps stack length from the front', () => {
    let stack: number[] = []
    for (let i = 1; i <= 5; i++) stack = pushCapped(stack, i, 3)
    expect(stack).toEqual([3, 4, 5])
  })

  it('titles trash / move / rename', () => {
    expect(undoActionTitle({ kind: 'trash', paths: ['a'], label: 'a' })).toBe('Undo Delete')
    expect(undoActionTitle({ kind: 'trash', paths: ['a', 'b'], label: 'a' })).toBe(
      'Undo Delete (2)'
    )
    expect(undoActionTitle({ kind: 'rename', from: 'a', to: 'b', label: 'a' })).toBe('Undo Rename')
    expect(
      undoActionTitle({
        kind: 'power-rename',
        pairs: [
          { from: 'a', to: 'b' },
          { from: 'c', to: 'd' }
        ],
        label: '2 items'
      })
    ).toBe('Undo Power Rename (2)')
    expect(
      redoActionTitle({ kind: 'move', pairs: [{ from: 'a', to: 'b' }], label: 'b' })
    ).toBe('Redo Move')
  })

  it('selects restored paths after undo delete', () => {
    const entry: UndoEntry = { kind: 'trash', paths: ['C:\\a', 'C:\\b'], label: 'a' }
    expect(pathsAfterUndo(entry)).toEqual(['C:\\a', 'C:\\b'])
    expect(pathsAfterRedo(entry)).toEqual([])
  })

  it('selects original locations after undo move', () => {
    const entry: UndoEntry = {
      kind: 'move',
      pairs: [
        { from: 'C:\\src\\a', to: 'C:\\dst\\a' },
        { from: 'C:\\src\\b', to: 'C:\\dst\\b' }
      ],
      label: 'a'
    }
    expect(pathsAfterUndo(entry)).toEqual(['C:\\src\\a', 'C:\\src\\b'])
    expect(pathsAfterRedo(entry)).toEqual(['C:\\dst\\a', 'C:\\dst\\b'])
  })
})
