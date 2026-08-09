import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginDoubleSingleClick,
  cancelDoubleSingleClick,
  DOUBLE_SINGLE_CLICK_MS
} from '../renderer/lib/doubleSingleClick'

describe('doubleSingleClick', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    cancelDoubleSingleClick()
  })
  afterEach(() => {
    cancelDoubleSingleClick()
    vi.useRealTimers()
  })

  it('fires after the double-click window if undisturbed', () => {
    const onFire = vi.fn()
    beginDoubleSingleClick(10, 20, onFire)
    vi.advanceTimersByTime(DOUBLE_SINGLE_CLICK_MS - 1)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFire).toHaveBeenCalledOnce()
  })

  it('cancelDoubleSingleClick prevents fire', () => {
    const onFire = vi.fn()
    beginDoubleSingleClick(10, 20, onFire)
    cancelDoubleSingleClick()
    vi.advanceTimersByTime(DOUBLE_SINGLE_CLICK_MS + 50)
    expect(onFire).not.toHaveBeenCalled()
  })
})
