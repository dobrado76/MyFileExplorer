import { describe, expect, it } from 'vitest'
import { nextSelectionAfterDelete } from '../renderer/lib/nextSelection'

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
})
