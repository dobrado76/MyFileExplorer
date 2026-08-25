/**
 * While a slideshow is playing, park large path arrays outside Zustand/settings
 * so decode/GC stay independent of folder size. Restore on stop.
 */

let parkedImageListCache: string[] | null = null
let clearViewOrderCacheFn: (() => void) | null = null

/** appStore registers its view-order path cache clearer (avoids circular imports). */
export function registerViewOrderCacheClear(fn: () => void): void {
  clearViewOrderCacheFn = fn
}

export function clearViewOrderCache(): void {
  clearViewOrderCacheFn?.()
}

/** Keep one path array alive for restore; store/settings hold `[]` during play. */
export function parkImageListCache(cache: string[]): void {
  parkedImageListCache = cache
}

/** `null` when nothing was parked (build cancel / no cache). */
export function takeParkedImageListCacheIfAny(): string[] | null {
  if (parkedImageListCache == null) return null
  const next = parkedImageListCache
  parkedImageListCache = null
  return next
}

export function discardParkedImageListCache(): void {
  parkedImageListCache = null
}
