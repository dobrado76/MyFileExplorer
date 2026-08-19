import { describe, expect, it } from 'vitest'
import { formatFileOpCounts } from '../shared/fileOpCounts'

describe('formatFileOpCounts', () => {
  it('does not clamp a large walk down to a 1-item total', () => {
    expect(formatFileOpCounts(1, 1)).toBe('1 of 1')
    expect(formatFileOpCounts(12_345, 1)).toBe('12,345 of 12,345')
    expect(formatFileOpCounts(12_345, 100_000)).toBe('12,345 of 100,000')
  })

  it('shows scanned while the total is still unknown', () => {
    expect(formatFileOpCounts(0, 0)).toBe('…')
    expect(formatFileOpCounts(800, 0)).toBe('800 scanned')
  })
})
