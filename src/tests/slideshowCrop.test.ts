import { describe, expect, it } from 'vitest'
import {
  applyCropStep,
  cropExtractRect,
  EMPTY_SLIDESHOW_CROP,
  numpadCropStepPct
} from '../shared/slideshow/crop'

describe('numpadCropStepPct', () => {
  it('returns 10/5/2/1 percent for modifiers', () => {
    expect(numpadCropStepPct(false, false)).toBe(0.1)
    expect(numpadCropStepPct(true, false)).toBe(0.05)
    expect(numpadCropStepPct(false, true)).toBe(0.02)
    expect(numpadCropStepPct(true, true)).toBe(0.01)
  })
})

describe('applyCropStep', () => {
  it('accumulates example 2+2+6+Shift-4 on a 1000×800 image', () => {
    let acc = EMPTY_SLIDESHOW_CROP
    acc = applyCropStep(acc, 'bottom', 0.1)
    acc = applyCropStep(acc, 'bottom', 0.1)
    acc = applyCropStep(acc, 'right', 0.1)
    acc = applyCropStep(acc, 'left', 0.05)
    expect(acc).toEqual({ top: 0, right: 0.1, bottom: 0.2, left: 0.05 })
    const rect = cropExtractRect(1000, 800, acc)
    expect(rect).toEqual({ left: 50, top: 0, width: 850, height: 640 })
  })

  it('rejects crop that removes the entire image', () => {
    let acc = applyCropStep(EMPTY_SLIDESHOW_CROP, 'top', 0.5)
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
