import { describe, expect, it } from 'vitest'
import { detailsTableMinWidth } from '../renderer/lib/detailsTable'

describe('detailsTableMinWidth', () => {
  it('adds padding and one gap per extra column', () => {
    expect(detailsTableMinWidth(200, [150])).toBe(20 + 200 + 150 + 8)
    expect(detailsTableMinWidth(200, [150, 90])).toBe(20 + 200 + 150 + 90 + 16)
  })
})
