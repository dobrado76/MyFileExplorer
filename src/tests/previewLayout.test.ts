import { describe, expect, it } from 'vitest'
import { previewLayoutWide } from '../shared/previewLayout'

describe('previewLayoutWide', () => {
  it('is wide when width is clearly larger than height', () => {
    expect(previewLayoutWide(800, 400)).toBe(true)
    expect(previewLayoutWide(1600, 900, false)).toBe(true)
  })

  it('is stacked when height is clearly larger than width', () => {
    expect(previewLayoutWide(320, 800)).toBe(false)
    expect(previewLayoutWide(400, 900, true)).toBe(false)
  })

  it('keeps the previous side when nearly square', () => {
    expect(previewLayoutWide(400, 400, true)).toBe(true)
    expect(previewLayoutWide(400, 400, false)).toBe(false)
    expect(previewLayoutWide(404, 400, false)).toBe(false)
    expect(previewLayoutWide(400, 404, true)).toBe(true)
  })
})
