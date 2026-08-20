import { describe, expect, it } from 'vitest'
import { visibleIndexRange } from '../shared/visibleIndexRange'

describe('visibleIndexRange', () => {
  it('uses the virtualizer range when geometry is unknown', () => {
    expect(
      visibleIndexRange({
        rangeStart: 3,
        rangeEnd: 10,
        rowCount: 40,
        rowHeight: 24
      })
    ).toEqual({ start: 3, end: 10 })
  })

  it('falls back when range is missing (no scrollbar / first paint)', () => {
    expect(
      visibleIndexRange({
        rangeStart: 0,
        rangeEnd: -1,
        rowCount: 8,
        scrollTop: 0,
        clientHeight: 400,
        rowHeight: 24,
        overscan: 2
      })
    ).toEqual({ start: 0, end: 7 })
  })

  it('widens a stale short virtualizer range with the viewport', () => {
    expect(
      visibleIndexRange({
        rangeStart: 0,
        rangeEnd: 1,
        rowCount: 8,
        scrollTop: 0,
        clientHeight: 400,
        rowHeight: 24,
        overscan: 2
      })
    ).toEqual({ start: 0, end: 7 })
  })

  it('unions a lagged virtualizer range with the scrolled viewport', () => {
    expect(
      visibleIndexRange({
        rangeStart: 10,
        rangeEnd: 14,
        rowCount: 80,
        scrollTop: 16 * 24,
        clientHeight: 240,
        rowHeight: 24,
        overscan: 2
      })
    ).toEqual({ start: 10, end: 28 })
  })

  it('returns null for an empty listing', () => {
    expect(
      visibleIndexRange({
        rangeStart: 0,
        rangeEnd: -1,
        rowCount: 0,
        rowHeight: 24
      })
    ).toBeNull()
  })
})
