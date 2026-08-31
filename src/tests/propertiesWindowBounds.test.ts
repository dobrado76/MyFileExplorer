import { describe, expect, it } from 'vitest'
import {
  PROPERTIES_WINDOW_DEFAULT_HEIGHT,
  PROPERTIES_WINDOW_DEFAULT_WIDTH,
  PROPERTIES_WINDOW_MIN_HEIGHT,
  PROPERTIES_WINDOW_MIN_WIDTH,
  propertiesWindowDefaultBounds
} from '../shared/propertiesWindowBounds'

describe('propertiesWindowDefaultBounds', () => {
  it('centers the default card on the work area', () => {
    const b = propertiesWindowDefaultBounds({ x: 100, y: 50, width: 1920, height: 1080 })
    expect(b.width).toBe(PROPERTIES_WINDOW_DEFAULT_WIDTH)
    expect(b.height).toBe(PROPERTIES_WINDOW_DEFAULT_HEIGHT)
    expect(b.x).toBe(100 + Math.floor((1920 - PROPERTIES_WINDOW_DEFAULT_WIDTH) / 2))
    expect(b.y).toBe(50 + Math.floor((1080 - PROPERTIES_WINDOW_DEFAULT_HEIGHT) / 2))
  })

  it('respects min size constants', () => {
    expect(PROPERTIES_WINDOW_MIN_WIDTH).toBe(420)
    expect(PROPERTIES_WINDOW_MIN_HEIGHT).toBe(360)
  })
})
