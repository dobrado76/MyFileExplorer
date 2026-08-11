import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelDoubleSingleClick,
  DOUBLE_SINGLE_CLICK_MS,
  handleLabelClickForRename,
  isSlowSecondLabelClick,
  noteItemClick,
  scheduleLabelRename,
  suppressLabelRenameBriefly
} from '../renderer/lib/doubleSingleClick'

describe('Explorer label rename (two-click + hover wait)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    cancelDoubleSingleClick()
  })
  afterEach(() => {
    cancelDoubleSingleClick()
    vi.useRealTimers()
  })

  it('first label click only arms — does not rename', () => {
    const fire = vi.fn()
    expect(handleLabelClickForRename('C:\\a.txt', fire)).toBe(false)
    vi.advanceTimersByTime(DOUBLE_SINGLE_CLICK_MS + 50)
    expect(fire).not.toHaveBeenCalled()
  })

  it('fast second click (within double-click window) does not rename', () => {
    const fire = vi.fn()
    noteItemClick('C:\\a.txt')
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS - 1)
    expect(handleLabelClickForRename('C:\\a.txt', fire)).toBe(false)
    vi.advanceTimersByTime(DOUBLE_SINGLE_CLICK_MS + 50)
    expect(fire).not.toHaveBeenCalled()
  })

  it('slow second label click + hover wait starts rename', () => {
    const fire = vi.fn()
    noteItemClick('C:\\a.txt')
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS + 1)
    expect(isSlowSecondLabelClick('C:\\a.txt')).toBe(true)
    expect(handleLabelClickForRename('C:\\a.txt', fire, 10, 10)).toBe(true)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(DOUBLE_SINGLE_CLICK_MS - 1)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('already-selected lone click is first click only; needs another slow click', () => {
    const fire = vi.fn()
    // File was selected long ago — no recent noteItemClick.
    expect(handleLabelClickForRename('C:\\a.txt', fire)).toBe(false)
    vi.advanceTimersByTime(DOUBLE_SINGLE_CLICK_MS + 50)
    expect(fire).not.toHaveBeenCalled()

    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS + 1)
    expect(handleLabelClickForRename('C:\\a.txt', fire)).toBe(true)
    vi.advanceTimersByTime(DOUBLE_SINGLE_CLICK_MS)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('cancel before hover wait prevents rename (double-click open)', () => {
    const fire = vi.fn()
    noteItemClick('C:\\a.txt')
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS + 1)
    handleLabelClickForRename('C:\\a.txt', fire)
    cancelDoubleSingleClick()
    vi.advanceTimersByTime(DOUBLE_SINGLE_CLICK_MS + 10)
    expect(fire).not.toHaveBeenCalled()
  })

  it('pointer move cancels pending hover rename', () => {
    const fire = vi.fn()
    const listeners = new Map<string, EventListener>()
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: EventListener) => {
        listeners.set(type, fn)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      }
    })
    noteItemClick('C:\\a.txt')
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS + 1)
    handleLabelClickForRename('C:\\a.txt', fire, 100, 100)
    const onMove = listeners.get('pointermove')
    expect(onMove).toBeTypeOf('function')
    onMove?.({ clientX: 120, clientY: 100 } as PointerEvent)
    vi.advanceTimersByTime(DOUBLE_SINGLE_CLICK_MS + 10)
    expect(fire).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('suppress blocks schedule after click-away rename dismiss', () => {
    const fire = vi.fn()
    noteItemClick('C:\\a.txt')
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS + 1)
    suppressLabelRenameBriefly(DOUBLE_SINGLE_CLICK_MS)
    scheduleLabelRename('C:\\a.txt', fire)
    vi.advanceTimersByTime(DOUBLE_SINGLE_CLICK_MS + 100)
    expect(fire).not.toHaveBeenCalled()
  })
})
