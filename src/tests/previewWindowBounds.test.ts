import { describe, expect, it } from 'vitest'
import { previewWindowDefaultBounds } from '../shared/previewWindowBounds'

describe('previewWindowDefaultBounds', () => {
  it('uses 90% of the work area, centered', () => {
    const b = previewWindowDefaultBounds({ x: 0, y: 0, width: 1920, height: 1080 })
    expect(b).toEqual({ x: 96, y: 54, width: 1728, height: 972 })
  })

  it('honors a non-origin work area (taskbar / secondary display)', () => {
    const b = previewWindowDefaultBounds({ x: 100, y: 40, width: 1600, height: 900 })
    expect(b.width).toBe(1440)
    expect(b.height).toBe(810)
    expect(b.x).toBe(180)
    expect(b.y).toBe(85)
  })
})
