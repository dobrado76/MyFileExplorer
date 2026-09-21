import { describe, expect, it } from 'vitest'
import {
  clearRenameIgnoreBlur,
  idleRenameGesture,
  onRenameBlur,
  onRenameClick,
  onRenamePointerDown,
  onRenamePointerUp
} from '../renderer/lib/renameGesture'

describe('rename gesture', () => {
  it('keeps rename open when a selection drag is released outside the box', () => {
    let g = idleRenameGesture()
    const down = onRenamePointerDown(g, true)
    expect(down.commit).toBe(false)
    g = down.gesture
    expect(onRenameBlur(g)).toEqual({ commit: false, refocus: true })

    const up = onRenamePointerUp(g, false)
    expect(up.restore).toBe(true)
    g = up.gesture
    expect(onRenameBlur(g)).toEqual({ commit: false, refocus: true })

    const click = onRenameClick(g, false)
    expect(click.swallow).toBe(true)
    g = clearRenameIgnoreBlur(click.gesture)
    expect(onRenameBlur(g).commit).toBe(true)
  })

  it('still commits on a real click outside the field', () => {
    const down = onRenamePointerDown(idleRenameGesture(), false)
    expect(down.commit).toBe(true)
    expect(onRenameBlur(down.gesture).commit).toBe(true)
  })

  it('does not swallow a click that ends inside the field', () => {
    const down = onRenamePointerDown(idleRenameGesture(), true)
    const up = onRenamePointerUp(down.gesture, true)
    expect(up.restore).toBe(false)
    expect(onRenameClick(up.gesture, true).swallow).toBe(false)
  })
})
