import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelDoubleSingleClick,
  DOUBLE_SINGLE_CLICK_MS,
  noteItemClick,
  tryLabelRenameClick
} from '../renderer/lib/doubleSingleClick'

describe('label rename click (Explorer two-click)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    cancelDoubleSingleClick()
  })
  afterEach(() => {
    cancelDoubleSingleClick()
    vi.useRealTimers()
  })

  it('renames on a slow second label click after select', () => {
    noteItemClick('C:\\a.txt')
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS + 1)
    expect(tryLabelRenameClick('C:\\a.txt')).toBe(true)
  })

  it('does not rename inside the double-click window', () => {
    noteItemClick('C:\\a.txt')
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS - 1)
    expect(tryLabelRenameClick('C:\\a.txt')).toBe(false)
  })

  it('renames on first label click when nothing was noted (e.g. keyboard select)', () => {
    expect(tryLabelRenameClick('C:\\a.txt')).toBe(true)
  })

  it('cancel clears timing so the next click is a fresh first click', () => {
    noteItemClick('C:\\a.txt')
    cancelDoubleSingleClick()
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS + 1)
    // After cancel, treated like keyboard-select: first label click renames.
    expect(tryLabelRenameClick('C:\\a.txt')).toBe(true)
  })

  it('switching items requires a fresh slow second click', () => {
    noteItemClick('C:\\a.txt')
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS + 1)
    noteItemClick('C:\\b.txt')
    expect(tryLabelRenameClick('C:\\b.txt')).toBe(false)
    vi.setSystemTime(Date.now() + DOUBLE_SINGLE_CLICK_MS + 1)
    expect(tryLabelRenameClick('C:\\b.txt')).toBe(true)
  })
})
