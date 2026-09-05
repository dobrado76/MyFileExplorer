import { describe, expect, it } from 'vitest'
import { folderHistory, rewriteHistoryEntry, searchHistory } from '../shared/tabHistory'
import { rewritePathAfterRename } from '../renderer/lib/renameListing'
import {
  historyFocusStillActive,
  historyLateListingAction,
  resolveBackFocusPath
} from '../renderer/lib/historyFocus'

const parent = '\\\\nas\\share\\Series'
const childA = '\\\\nas\\share\\Series\\Album A'
const childB = '\\\\nas\\share\\Series\\Album B'

describe('resolveBackFocusPath', () => {
  it('keeps an explicit focusPath from the history entry', () => {
    const prev = folderHistory(parent, 800, childA)
    expect(resolveBackFocusPath(prev, childA, parent)).toBe(childA)
  })

  it('falls back to the child we left when history has no focusPath', () => {
    const prev = folderHistory(parent, 800)
    expect(resolveBackFocusPath(prev, childA, parent)).toBe(childA)
  })

  it('does not invent focus when Back is not parent→child', () => {
    const prev = folderHistory('\\\\nas\\share\\Other', 0)
    expect(resolveBackFocusPath(prev, childA, parent)).toBeUndefined()
  })

  it('ignores search history entries', () => {
    const prev = searchHistory('foo', parent, false)
    expect(resolveBackFocusPath(prev, childA, parent)).toBeUndefined()
  })
})

describe('historyFocusStillActive', () => {
  it('is true when selection and focus are still the history row', () => {
    expect(
      historyFocusStillActive({
        listingPath: parent,
        tabPath: parent,
        focusPath: childA,
        selected: [childA],
        focusedPath: childA
      })
    ).toBe(true)
  })

  it('allows null focusedPath when selection is still the history row', () => {
    expect(
      historyFocusStillActive({
        listingPath: parent,
        tabPath: parent,
        focusPath: childA,
        selected: [childA],
        focusedPath: null
      })
    ).toBe(true)
  })

  it('is false after Arrow Down moved selection to the next folder', () => {
    // Back landed on Album A; user pressed ↓ to Album B before NAS listing finished.
    expect(
      historyFocusStillActive({
        listingPath: parent,
        tabPath: parent,
        focusPath: childA,
        selected: [childB],
        focusedPath: childB
      })
    ).toBe(false)
  })

  it('is false when multi-select', () => {
    expect(
      historyFocusStillActive({
        listingPath: parent,
        tabPath: parent,
        focusPath: childA,
        selected: [childA, childB],
        focusedPath: childA
      })
    ).toBe(false)
  })

  it('is false when the tab already navigated away', () => {
    expect(
      historyFocusStillActive({
        listingPath: parent,
        tabPath: childB,
        focusPath: childA,
        selected: [childA],
        focusedPath: childA
      })
    ).toBe(false)
  })

  it('matches focus case-insensitively (UNC / drive letter)', () => {
    expect(
      historyFocusStillActive({
        listingPath: 'Z:\\Series',
        tabPath: 'z:\\Series',
        focusPath: 'Z:\\Series\\Album A',
        selected: ['z:\\series\\album a'],
        focusedPath: 'Z:\\SERIES\\Album A'
      })
    ).toBe(true)
  })
})

describe('historyLateListingAction (anti-regression)', () => {
  it('scrollOnly when still on the Back focus row — may reveal, must not re-select', () => {
    expect(
      historyLateListingAction({
        listingPath: parent,
        tabPath: parent,
        focusPath: childA,
        selected: [childA],
        focusedPath: childA
      })
    ).toBe('scrollOnly')
  })

  it('none after Back → Arrow Down — late listing must not restore Album A', () => {
    // Regression: await loadListing then setSelection(focusPath) made F2 rename
    // the previous folder instead of the one the user arrowed to.
    expect(
      historyLateListingAction({
        listingPath: parent,
        tabPath: parent,
        focusPath: childA,
        selected: [childB],
        focusedPath: childB
      })
    ).toBe('none')
  })

  it('none when focusPath is missing', () => {
    expect(
      historyLateListingAction({
        listingPath: parent,
        tabPath: parent,
        focusPath: undefined,
        selected: [],
        focusedPath: null
      })
    ).toBe('none')
  })

  it('none when selection cleared', () => {
    expect(
      historyLateListingAction({
        listingPath: parent,
        tabPath: parent,
        focusPath: childA,
        selected: [],
        focusedPath: null
      })
    ).toBe('none')
  })

  it('action is only none|scrollOnly — never reselect after await', () => {
    const action = historyLateListingAction({
      listingPath: parent,
      tabPath: parent,
      focusPath: childA,
      selected: [childA],
      focusedPath: childA
    })
    expect(action === 'none' || action === 'scrollOnly').toBe(true)
  })
})

describe('history + file rename under focused child', () => {
  it('file rename under a folder must not rewrite that folder as history focus', () => {
    const entry = folderHistory(parent, 1200, childA)
    const from = `${childA}\\clip.mp4`
    const to = `${childA}\\clip-renamed.mp4`
    const rewrite = (p: string) => rewritePathAfterRename(p, from, to)
    const next = rewriteHistoryEntry(entry, rewrite)
    expect(next).toEqual(entry)
    expect(next.kind === 'folder' && next.focusPath).toBe(childA)
    expect(next.kind === 'folder' && next.scrollOffset).toBe(1200)
  })
})
