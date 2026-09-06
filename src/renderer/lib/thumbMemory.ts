type CacheEntry = { url: string; frames?: string[] }

const memoryCache = new Map<string, CacheEntry>()
const decodedUrls = new Set<string>()
const MAX_CACHE = 2000

export type ThumbMemoryEntry = CacheEntry

/** Listing and main can disagree on `/` vs `\\`; rev maps must use one key. */
export function thumbPathKey(filePath: string): string {
  return filePath.replace(/\//g, '\\').toLowerCase()
}

export function thumbMemoryKey(
  path: string,
  mtimeMs: number,
  size: number,
  videoThumbRev: number,
  imageThumbRev: number
): string {
  return `${thumbPathKey(path)}|${mtimeMs}|${size}|${videoThumbRev}|${imageThumbRev}`
}

export function getThumbMemory(key: string): ThumbMemoryEntry | undefined {
  const hit = memoryCache.get(key)
  if (!hit) return undefined
  // LRU touch — Map insertion order
  memoryCache.delete(key)
  memoryCache.set(key, hit)
  return hit
}

export function setThumbMemory(key: string, entry: ThumbMemoryEntry): void {
  if (memoryCache.has(key)) memoryCache.delete(key)
  memoryCache.set(key, entry)
  while (memoryCache.size > MAX_CACHE) {
    const oldest = memoryCache.keys().next().value
    if (oldest === undefined) break
    const evicted = memoryCache.get(oldest)
    memoryCache.delete(oldest)
    if (evicted) {
      decodedUrls.delete(evicted.url)
      if (evicted.frames) for (const u of evicted.frames) decodedUrls.delete(u)
    }
  }
}

export function markThumbDecoded(url: string): void {
  decodedUrls.add(url)
}

export function isThumbDecoded(url: string): boolean {
  return decodedUrls.has(url)
}

/** Drop cached thumbs for this file so the next request hits main (ADS tip). */
export function invalidateThumbMemory(filePath: string): void {
  const prefix = thumbPathKey(filePath) + '|'
  for (const k of [...memoryCache.keys()]) {
    if (k.startsWith(prefix)) {
      const evicted = memoryCache.get(k)
      memoryCache.delete(k)
      if (evicted) {
        decodedUrls.delete(evicted.url)
        if (evicted.frames) for (const u of evicted.frames) decodedUrls.delete(u)
      }
    }
  }
}

/** Drop cached thumbs for many files in one pass. */
export function invalidateThumbMemoryMany(filePaths: string[]): void {
  if (filePaths.length === 0) return
  if (filePaths.length === 1) {
    invalidateThumbMemory(filePaths[0]!)
    return
  }
  const prefixes = filePaths.map((p) => thumbPathKey(p) + '|')
  for (const k of [...memoryCache.keys()]) {
    if (prefixes.some((prefix) => k.startsWith(prefix))) {
      const evicted = memoryCache.get(k)
      memoryCache.delete(k)
      if (evicted) {
        decodedUrls.delete(evicted.url)
        if (evicted.frames) for (const u of evicted.frames) decodedUrls.delete(u)
      }
    }
  }
}
