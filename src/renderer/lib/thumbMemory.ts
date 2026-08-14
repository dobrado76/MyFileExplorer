type CacheEntry = { url: string; frames?: string[] }

const memoryCache = new Map<string, CacheEntry>()
const decodedUrls = new Set<string>()
const MAX_CACHE = 2000

export type ThumbMemoryEntry = CacheEntry

export function thumbMemoryKey(
  path: string,
  mtimeMs: number,
  size: number,
  videoThumbRev: number,
  imageThumbRev: number
): string {
  return `${path.toLowerCase()}|${mtimeMs}|${size}|${videoThumbRev}|${imageThumbRev}`
}

export function getThumbMemory(key: string): ThumbMemoryEntry | undefined {
  return memoryCache.get(key)
}

export function setThumbMemory(key: string, entry: ThumbMemoryEntry): void {
  if (memoryCache.size > MAX_CACHE) {
    memoryCache.clear()
    decodedUrls.clear()
  }
  memoryCache.set(key, entry)
}

export function markThumbDecoded(url: string): void {
  decodedUrls.add(url)
}

export function isThumbDecoded(url: string): boolean {
  return decodedUrls.has(url)
}

/** Drop cached thumbs for this file so the next request hits main (ADS tip). */
export function invalidateThumbMemory(filePath: string): void {
  const prefix = filePath.toLowerCase() + '|'
  for (const k of [...memoryCache.keys()]) {
    if (k.startsWith(prefix)) memoryCache.delete(k)
  }
}
