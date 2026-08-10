import { describe, expect, it } from 'vitest'
import { withIconRequestSlot } from '../renderer/lib/iconRequestQueue'

describe('withIconRequestSlot', () => {
  it('limits concurrent work', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const jobs = Array.from({ length: 12 }, () =>
      withIconRequestSlot(async () => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise((r) => setTimeout(r, 20))
        concurrent--
      })
    )
    await Promise.all(jobs)
    expect(maxConcurrent).toBeLessThanOrEqual(4)
    expect(maxConcurrent).toBeGreaterThan(0)
  })
})
