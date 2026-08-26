import { describe, expect, it } from 'vitest'
import { clipboardActionPaths } from '../renderer/lib/clipboardActionPaths'

function targetMatching(selectorHit: string | null): EventTarget {
  return {
    closest(selector: string) {
      if (!selectorHit) return null
      const parts = selector.split(',').map((s) => s.trim())
      return parts.includes(selectorHit) ? (this as unknown as Element) : null
    }
  } as unknown as EventTarget
}

describe('clipboardActionPaths', () => {
  const selected = ['C:\\repo\\a.txt', 'C:\\repo\\b.txt']
  const folder = 'C:\\repo'
  const treeFocus = 'C:\\repo\\src'

  it('uses the file-list selection when the event is not from the tree', () => {
    expect(
      clipboardActionPaths({
        selected,
        treeFocusPath: treeFocus,
        currentFolder: folder,
        eventTarget: targetMatching('.fileview')
      })
    ).toEqual(selected)
  })

  it('uses the tree folder when the event originated in the folder tree', () => {
    expect(
      clipboardActionPaths({
        selected,
        treeFocusPath: treeFocus,
        currentFolder: folder,
        eventTarget: targetMatching('.tree')
      })
    ).toEqual([treeFocus])
  })

  it('falls back to the current folder when the tree has no focus path', () => {
    expect(
      clipboardActionPaths({
        selected: [],
        treeFocusPath: null,
        currentFolder: folder,
        eventTarget: targetMatching('.pane-tree')
      })
    ).toEqual([folder])
  })
})
