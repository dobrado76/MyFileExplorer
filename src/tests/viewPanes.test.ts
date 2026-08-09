import { describe, expect, it } from 'vitest'
import { fillPaneSlots, remapPanesOnLayoutChange } from '../shared/viewPanes'

describe('viewPanes', () => {
  it('fills empty slots from unassigned tabs', () => {
    expect(fillPaneSlots(2, ['t1', null], ['t1', 't2', 't3'], 't1')).toEqual(['t1', 't2'])
  })

  it('does not clone when there are fewer tabs than panes', () => {
    expect(fillPaneSlots(4, ['t1', null, null, null], ['t1', 't2'], 't1')).toEqual([
      't1',
      't2',
      null,
      null
    ])
  })

  it('shrinks to 1 keeping focused tab', () => {
    const r = remapPanesOnLayoutChange(1, ['t1', 't2', 't3', 't4'], 2, [
      't1',
      't2',
      't3',
      't4'
    ])
    expect(r.paneTabIds).toEqual(['t3'])
    expect(r.focusedPaneIndex).toBe(0)
  })

  it('expands 1→2 and fills from other tabs', () => {
    const r = remapPanesOnLayoutChange(2, ['t1'], 0, ['t1', 't2'])
    expect(r.paneTabIds).toEqual(['t1', 't2'])
  })
})
