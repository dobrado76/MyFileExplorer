/**
 * Limit concurrent `icons:get` for per-file glyphs (.exe / .lnk / …) so a
 * large app folder does not flood main with hundreds of extract jobs at once.
 * Shared extension icons bypass this (they resolve from cache quickly).
 */

const MAX_CONCURRENT = 4
let active = 0
const waiters: Array<() => void> = []

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active++
      resolve()
    })
  })
}

function release(): void {
  active--
  const next = waiters.shift()
  if (next) next()
}

export async function withIconRequestSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
