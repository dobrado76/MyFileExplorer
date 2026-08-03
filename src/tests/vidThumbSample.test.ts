import { describe, expect, it } from 'vitest'
import { sampleVidThumbTimestamps } from '../shared/vidThumbCache'

describe('sampleVidThumbTimestamps', () => {
  it('places 20 samples evenly across the duration', () => {
    const times = sampleVidThumbTimestamps(100, 20)
    expect(times).toHaveLength(20)
    expect(times[0]).toBeCloseTo(2.5, 5)
    expect(times[19]).toBeCloseTo(97.5, 5)
    expect(times[1]! - times[0]!).toBeCloseTo(5, 5)
  })

  it('clamps near the end for short clips', () => {
    const times = sampleVidThumbTimestamps(0.2, 20)
    expect(times.every((t) => t >= 0 && t <= 0.2)).toBe(true)
  })
})
