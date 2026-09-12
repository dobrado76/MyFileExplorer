import { describe, expect, it } from 'vitest'
import {
  THUMB_REQUEST_MAX_CONCURRENT,
  withThumbRequestSlot
} from '../renderer/lib/thumbRequestQueue'

function liveSignal(): AbortSignal {
  return new AbortController().signal
}

describe('withThumbRequestSlot', () => {
  it('limits concurrent work', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const jobs = Array.from({ length: 16 }, () =>
      withThumbRequestSlot(async () => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise((r) => setTimeout(r, 20))
        concurrent--
      }, liveSignal())
    )
    await Promise.all(jobs)
    expect(maxConcurrent).toBeLessThanOrEqual(THUMB_REQUEST_MAX_CONCURRENT)
    expect(maxConcurrent).toBeGreaterThan(0)
  })

  it('drops a waiter aborted before it acquires a slot', async () => {
    const holderGates: Array<() => void> = []
    let acquired = 0
    let holdersReady!: () => void
    const holdersReadyP = new Promise<void>((r) => {
      holdersReady = r
    })

    const holders = Array.from({ length: THUMB_REQUEST_MAX_CONCURRENT }, () =>
      withThumbRequestSlot(async () => {
        await new Promise<void>((r) => {
          holderGates.push(r)
          acquired++
          if (acquired === THUMB_REQUEST_MAX_CONCURRENT) holdersReady()
        })
      }, liveSignal())
    )
    await holdersReadyP

    const ac = new AbortController()
    let ran = false
    const dropped = withThumbRequestSlot(async () => {
      ran = true
    }, ac.signal)
    ac.abort()
    expect(await dropped).toBeUndefined()
    expect(ran).toBe(false)

    for (const release of holderGates) release()
    await Promise.all(holders)
  })

  it('starts the newest waiter when a slot frees (LIFO)', async () => {
    const holderGates: Array<() => void> = []
    let acquired = 0
    let holdersReady!: () => void
    const holdersReadyP = new Promise<void>((r) => {
      holdersReady = r
    })

    const holders = Array.from({ length: THUMB_REQUEST_MAX_CONCURRENT }, () =>
      withThumbRequestSlot(async () => {
        await new Promise<void>((r) => {
          holderGates.push(r)
          acquired++
          if (acquired === THUMB_REQUEST_MAX_CONCURRENT) holdersReady()
        })
      }, liveSignal())
    )
    await holdersReadyP

    const order: string[] = []
    const wa = withThumbRequestSlot(async () => {
      order.push('A')
    }, liveSignal())
    const wb = withThumbRequestSlot(async () => {
      order.push('B')
    }, liveSignal())
    const wc = withThumbRequestSlot(async () => {
      order.push('C')
    }, liveSignal())

    holderGates[0]!()
    await Promise.all([wa, wb, wc])
    expect(order).toEqual(['C', 'B', 'A'])

    for (const release of holderGates.slice(1)) release()
    await Promise.all(holders)
  })
})
