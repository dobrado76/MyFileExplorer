import { describe, expect, it } from 'vitest'
import {
  applyCropStep,
  cropExtractRect,
  EMPTY_SLIDESHOW_CROP,
  numpadCropStepPct,
  type SlideshowCropEdge
} from '../shared/slideshow/crop'
import { isSlideshowCropNumpadKey } from '../shared/slideshow/keys'

describe('numpadCropStepPct', () => {
  it('returns 5/2.5/1/0.5 percent for modifiers', () => {
    expect(numpadCropStepPct(false, false)).toBe(0.05)
    expect(numpadCropStepPct(true, false)).toBe(0.025)
    expect(numpadCropStepPct(false, true)).toBe(0.01)
    expect(numpadCropStepPct(true, true)).toBe(0.005)
  })
})

describe('isSlideshowCropNumpadKey', () => {
  it('matches crop numpad edges and save/cancel', () => {
    expect(isSlideshowCropNumpadKey({ key: '2', code: 'Numpad2' })).toBe(true)
    expect(isSlideshowCropNumpadKey({ key: '0', code: 'Numpad0' })).toBe(true)
    expect(isSlideshowCropNumpadKey({ key: '5', code: 'Numpad5' })).toBe(true)
    expect(isSlideshowCropNumpadKey({ key: 'a', code: 'KeyA' })).toBe(false)
  })
})

describe('applyCropStep', () => {
  it('accumulates example 2+2+6+Shift-4 on a 1000×800 image', () => {
    const steps: Array<[SlideshowCropEdge, number]> = [
      ['bottom', 0.1],
      ['bottom', 0.1],
      ['right', 0.1],
      ['left', 0.05]
    ]
    const acc = steps.reduce(
      (c, [edge, pct]) => applyCropStep(c, edge, pct),
      EMPTY_SLIDESHOW_CROP
    )
    expect(acc).toEqual({ top: 0, right: 0.1, bottom: 0.2, left: 0.05 })
    const rect = cropExtractRect(1000, 800, acc)
    expect(rect).toEqual({ left: 50, top: 0, width: 850, height: 640 })
  })

  it('rejects crop that removes the entire image', () => {
    const acc = applyCropStep(EMPTY_SLIDESHOW_CROP, 'top', 0.5)
    expect(() => applyCropStep(acc, 'bottom', 0.5)).toThrow(/entire image/)
  })
})

describe('cropExtractRect', () => {
  it('clamps to at least 1×1 pixel', () => {
    const rect = cropExtractRect(10, 10, { top: 0.9, right: 0, bottom: 0, left: 0.9 })
    expect(rect.width).toBeGreaterThanOrEqual(1)
    expect(rect.height).toBeGreaterThanOrEqual(1)
  })
})
