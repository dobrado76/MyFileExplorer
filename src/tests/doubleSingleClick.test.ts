import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginDoubleSingleClick,
  cancelDoubleSingleClick,
  DOUBLE_SINGLE_CLICK_MS
} from '../renderer/lib/doubleSingleClick'

describe('doubleSingleClick', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    cancelDoubleSingleClick()
  })
  afterEach(() => {
    cancelDoubleSingleClick()
    vi.useRealTimers()
  })

  it('does not fire from a single click + wait (no dwell rename)', () => {
    const onFire = vi.fn()
    beginDoubleSingleClick(10, 20, 'C:\\a.txt', onFire)
    vi.advanceTimersByTime(DOUBLE_SINGLE_CLICK_MS + 5_000)
    expect(onFire).not.toHaveBeenCalled()
  })

  it('fires on a second slow click of the same item', () => {
    const onFire = vi.fn()
    beginDoubleSingleClick(10, 20, 'C:\\a.txt', onFire)
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS + 1)
    beginDoubleSingleClick(12, 22, 'C:\\a.txt', onFire)
    expect(onFire).toHaveBeenCalledOnce()
  })

  it('does not fire when the second click is inside the double-click window', () => {
    const onFire = vi.fn()
    beginDoubleSingleClick(10, 20, 'C:\\a.txt', onFire)
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS - 1)
    beginDoubleSingleClick(10, 20, 'C:\\a.txt', onFire)
    expect(onFire).not.toHaveBeenCalled()
  })

  it('cancelDoubleSingleClick clears a pending arm', () => {
    const onFire = vi.fn()
    beginDoubleSingleClick(10, 20, 'C:\\a.txt', onFire)
    cancelDoubleSingleClick()
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS + 1)
    beginDoubleSingleClick(10, 20, 'C:\\a.txt', onFire)
    // Fresh arm after cancel — still needs a second slow click.
    expect(onFire).not.toHaveBeenCalled()
  })

  it('switching items restarts the arm', () => {
    const onFire = vi.fn()
    beginDoubleSingleClick(10, 20, 'C:\\a.txt', onFire)
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS + 1)
    beginDoubleSingleClick(10, 20, 'C:\\b.txt', onFire)
    expect(onFire).not.toHaveBeenCalled()
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS + 1)
    beginDoubleSingleClick(10, 20, 'C:\\b.txt', onFire)
    expect(onFire).toHaveBeenCalledOnce()
  })
})
