/** Folder/cache playlist cursor — skip set, no array copies. */

export type SlideshowPlaylistCursor = {
  paths: string[]
  skipped?: Set<number>
  compiledMode?: boolean
  compiledTotal?: number
}

export function slideshowLength(a: SlideshowPlaylistCursor): number {
  if (a.compiledMode) return a.compiledTotal ?? 0
  return Math.max(0, a.paths.length - (a.skipped?.size ?? 0))
}

export function slideshowIndexSkipped(a: SlideshowPlaylistCursor, index: number): boolean {
  return a.skipped?.has(index) === true
}

/** Next/previous unskipped physical index, or null if none remain. */
export function slideshowNextIndex(
  a: SlideshowPlaylistCursor,
  from: number,
  dir: 1 | -1,
  loop: boolean
): number | null {
  const n = a.paths.length
  if (n === 0) return null
  const live = slideshowLength(a)
  if (live <= 0) return null
  let i = from
  for (let step = 0; step < n; step++) {
    i += dir
    if (i >= n || i < 0) {
      if (!loop) return null
      i = i >= n ? 0 : n - 1
    }
    if (!slideshowIndexSkipped(a, i)) return i
  }
  return null
}

export function slideshowFirstIndex(a: SlideshowPlaylistCursor): number | null {
  return slideshowNextIndex(a, -1, 1, false)
}

export function slideshowLastIndex(a: SlideshowPlaylistCursor): number | null {
  return slideshowNextIndex(a, a.paths.length, -1, false)
}
