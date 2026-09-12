/**
 * Limit Sharp thumbnail encodes so a fast-scroll through a photo folder
 * cannot flood libuv / RAM and starve preview / mfe-media (same class of
 * problem as shell-icon extractQueue). Cache hits must not use this queue.
 *
 * Waiters are LIFO: the tiles the user just scrolled to run before ones they
 * already passed.
 */

type Job = {
  run: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
}

const queue: Job[] = []
let running = 0
const MAX_CONCURRENT = 2

export const THUMB_GENERATE_MAX_CONCURRENT = MAX_CONCURRENT

function yieldMain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function pump(): void {
  if (running >= MAX_CONCURRENT || queue.length === 0) return
  const job = queue.pop()!
  running++
  void (async () => {
    try {
      await yieldMain()
      const value = await job.run()
      job.resolve(value)
    } catch (err) {
      job.reject(err)
    } finally {
      running--
      await yieldMain()
      pump()
    }
  })()
}

/** Run Sharp (or other heavy) thumb encode work on the limited LIFO queue. */
export function enqueueThumbGenerate<T>(run: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push({
      run,
      resolve: (value) => resolve(value as T),
      reject
    })
    pump()
  })
}
