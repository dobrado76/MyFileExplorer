/**
 * Limit concurrent `thumbs:get` so scrolling an icon view does not flood
 * main with Sharp jobs (which also starves preview / mfe-media).
 *
 * Waiters are LIFO so newly visible tiles run before ones the user already
 * scrolled past. Aborting a waiter before it acquires a slot drops it — in-flight
 * IPC still finishes so the memory cache can warm.
 */

const MAX_CONCURRENT = 6
let active = 0

type Waiter = {
  cancelled: boolean
  settled: boolean
  resume: () => void
}

const waiters: Waiter[] = []

export const THUMB_REQUEST_MAX_CONCURRENT = MAX_CONCURRENT

function acquire(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  if (active < MAX_CONCURRENT) {
    active++
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    const waiter: Waiter = {
      cancelled: false,
      settled: false,
      resume: () => {
        if (waiter.settled) return
        waiter.settled = true
        active++
        resolve(true)
      }
    }
    const onAbort = (): void => {
      if (waiter.settled) return
      waiter.settled = true
      waiter.cancelled = true
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    waiters.push(waiter)
  })
}

function release(): void {
  active--
  while (waiters.length > 0) {
    const next = waiters.pop()!
    if (next.cancelled || next.settled) continue
    next.resume()
    return
  }
}

export async function withThumbRequestSlot<T>(
  fn: () => Promise<T>,
  signal: AbortSignal
): Promise<T | undefined> {
  const got = await acquire(signal)
  if (!got) return undefined
  try {
    return await fn()
  } finally {
    release()
  }
}
