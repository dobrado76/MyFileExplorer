import { describe, expect, it } from 'vitest'
import { enqueueThumbGenerate, THUMB_GENERATE_MAX_CONCURRENT } from '../main/thumbs/generateQueue'

function yieldImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function drainYields(): Promise<void> {
  await yieldImmediate()
  await yieldImmediate()
}

describe('enqueueThumbGenerate', () => {
  it('limits concurrent work', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const jobs = Array.from({ length: 8 }, () =>
      enqueueThumbGenerate(async () => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise((r) => setTimeout(r, 20))
        concurrent--
      })
    )
    await Promise.all(jobs)
    expect(maxConcurrent).toBeLessThanOrEqual(THUMB_GENERATE_MAX_CONCURRENT)
    expect(maxConcurrent).toBeGreaterThan(0)
  })

  it('starts the newest waiter when a slot frees (LIFO)', async () => {
    const startOrder: string[] = []
    const holderGates: Array<() => void> = []

    const hold = (id: string): Promise<void> =>
      enqueueThumbGenerate(async () => {
        startOrder.push(id)
        await new Promise<void>((r) => holderGates.push(r))
      })

    const a = hold('A')
    await drainYields()
    const b = hold('B')
    await drainYields()
    for (let i = 0; i < 20 && startOrder.length < 2; i++) await drainYields()
    expect(startOrder).toEqual(['A', 'B'])

    const c = enqueueThumbGenerate(async () => {
      startOrder.push('C')
    })
    const d = enqueueThumbGenerate(async () => {
      startOrder.push('D')
    })
    const e = enqueueThumbGenerate(async () => {
      startOrder.push('E')
    })

    holderGates[0]!()
    await Promise.all([a, e])
    expect(startOrder[2]).toBe('E')

    holderGates[1]!()
    await Promise.all([b, c, d])
  })
})
