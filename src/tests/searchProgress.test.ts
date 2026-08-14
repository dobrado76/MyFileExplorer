import { describe, expect, it } from 'vitest'
import { formatSearchProgress } from '../shared/searchProgress'

describe('formatSearchProgress', () => {
  it('formats folder walk progress with scan count and path', () => {
    expect(
      formatSearchProgress({
        phase: 'walking',
        current: 1234,
        message: 'D:\\Projects\\App'
      })
    ).toBe('1,234 scanned · D:\\Projects\\App')
  })

  it('formats index query progress', () => {
    expect(formatSearchProgress({ phase: 'querying', message: 'D:\\' })).toBe(
      'Querying index — D:\\'
    )
  })
})
