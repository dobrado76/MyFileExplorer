import { describe, expect, it } from 'vitest'
import {
  nextSelectionAfterDelete,
  resolveSelectionAfterLazyDelete,
  selectionChangedDuringLazyDelete
} from '../renderer/lib/nextSelection'

describe('nextSelectionAfterDelete', () => {
  const list = ['a', 'b', 'c', 'd', 'e']

  it('selects the next item after a single delete', () => {
    expect(nextSelectionAfterDelete(list, ['c'])).toBe('d')
  })

  it('selects the previous item when deleting the last', () => {
    expect(nextSelectionAfterDelete(list, ['e'])).toBe('d')
  })

  it('selects after a contiguous multi-delete range', () => {
    expect(nextSelectionAfterDelete(list, ['b', 'c'])).toBe('d')
  })

  it('selects previous when multi-delete includes the end', () => {
    expect(nextSelectionAfterDelete(list, ['d', 'e'])).toBe('c')
  })

  it('returns null when everything was deleted', () => {
    expect(nextSelectionAfterDelete(list, list)).toBeNull()
  })

  it('is case-insensitive for Windows paths', () => {
    expect(nextSelectionAfterDelete(['C:\\A', 'C:\\B', 'C:\\C'], ['c:\\b'])).toBe('C:\\C')
  })

  it('treats slash variants as the same path', () => {
    expect(nextSelectionAfterDelete(['C:\\A', 'C:\\B', 'C:\\C'], ['C:/B'])).toBe('C:\\C')
  })
})

describe('selectionChangedDuringLazyDelete (d8f2741)', () => {
  it('is false when selection is still the auto-picked survivor', () => {
    expect(selectionChangedDuringLazyDelete(['C:\\lib\\b'], ['C:\\lib\\b'])).toBe(false)
  })

  it('is true when the user selected another file while delete ran', () => {
    expect(selectionChangedDuringLazyDelete(['C:\\lib\\z'], ['C:\\lib\\b'])).toBe(true)
  })

  it('is true when the user multi-selected something else', () => {
    expect(
      selectionChangedDuringLazyDelete(['C:\\lib\\x', 'C:\\lib\\y'], ['C:\\lib\\b'])
    ).toBe(true)
  })

  it('is true when selection was cleared', () => {
    expect(selectionChangedDuringLazyDelete([], ['C:\\lib\\b'])).toBe(true)
  })
})

describe('resolveSelectionAfterLazyDelete (anti-regression d8f2741)', () => {
  const listing = ['C:\\lib\\a', 'C:\\lib\\b', 'C:\\lib\\c', 'C:\\lib\\z']

  it('keeps the user selection when they moved during a slow delete', () => {
    // Deleted "a"; auto-selected "b"; user clicked "z" before trash finished.
    const r = resolveSelectionAfterLazyDelete({
      currentSelection: ['C:\\lib\\z'],
      expectedSelection: ['C:\\lib\\b'],
      removed: ['C:\\lib\\a'],
      listingPaths: listing.filter((p) => p !== 'C:\\lib\\a'),
      selectionAnchor: 'C:\\lib\\z',
      focusedPath: 'C:\\lib\\z'
    })
    expect(r).toEqual({
      selected: ['C:\\lib\\z'],
      selectionAnchor: 'C:\\lib\\z',
      focusedPath: 'C:\\lib\\z'
    })
  })

  it('keeps auto survivor when the user did not move', () => {
    const r = resolveSelectionAfterLazyDelete({
      currentSelection: ['C:\\lib\\b'],
      expectedSelection: ['C:\\lib\\b'],
      removed: ['C:\\lib\\a'],
      listingPaths: listing.filter((p) => p !== 'C:\\lib\\a'),
      selectionAnchor: 'C:\\lib\\b',
      focusedPath: 'C:\\lib\\b'
    })
    expect(r).toEqual({
      selected: ['C:\\lib\\b'],
      selectionAnchor: 'C:\\lib\\b',
      focusedPath: 'C:\\lib\\b'
    })
  })

  it('does not snap back to expectedSelection after Arrow Down during delete', () => {
    const r = resolveSelectionAfterLazyDelete({
      currentSelection: ['C:\\lib\\c'],
      expectedSelection: ['C:\\lib\\b'],
      removed: ['C:\\lib\\a'],
      listingPaths: listing.filter((p) => p !== 'C:\\lib\\a'),
      selectionAnchor: 'C:\\lib\\c',
      focusedPath: 'C:\\lib\\c'
    })
    expect(r.selected).toEqual(['C:\\lib\\c'])
    expect(r.focusedPath).toBe('C:\\lib\\c')
  })

  it('drops paths that were deleted from a changed multi-selection', () => {
    const r = resolveSelectionAfterLazyDelete({
      currentSelection: ['C:\\lib\\a', 'C:\\lib\\z'],
      expectedSelection: ['C:\\lib\\b'],
      removed: ['C:\\lib\\a'],
      listingPaths: listing.filter((p) => p !== 'C:\\lib\\a'),
      selectionAnchor: 'C:\\lib\\a',
      focusedPath: 'C:\\lib\\z'
    })
    expect(r.selected).toEqual(['C:\\lib\\z'])
    expect(r.focusedPath).toBe('C:\\lib\\z')
  })
})
