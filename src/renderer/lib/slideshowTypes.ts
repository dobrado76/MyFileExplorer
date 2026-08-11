import type { CategorizerMapRow } from '@shared/slideshow/categorizerMap'

export type SlideshowStatus = 'building' | 'playing' | 'manual'

export type SlideshowAction =
  | {
      id: string
      type: 'delete'
      path: string
      mapName: string
      keyToken: string
      insertIndex: number
    }
  | {
      id: string
      type: 'categorize'
      path: string
      mapName: string
      keyToken: string
      destPath: string
      insertIndex: number
    }

export type SlideshowState = {
  status: SlideshowStatus
  /**
   * Folder / cache slideshow: full path list.
   * Compiled virtual mode: unused (empty); use compiledTotal + currentPath.
   */
  paths: string[]
  index: number
  builtFromCache: boolean
  /** Progress while building */
  buildFound: number
  buildCurrent: string
  actions: SlideshowAction[]
  /** Playing from compiled !!Lists / .dat indexes (virtual playlist in main). */
  compiledMode?: boolean
  /** Logical length of virtual compiled playlist (C# int scale). */
  compiledTotal?: number
  /** Path for `index` when compiledMode (resolved on demand). */
  currentPath?: string | null
  /** Playlist was truncated at Int32.MaxValue. */
  compiledTruncated?: boolean
}

export type SlideshowSession = {
  /** Gate-dependent session memory (cleared when gate off). */
  cacheActive: boolean
  imageListCache: string[]
  categorizerMap: CategorizerMapRow[]
  active: SlideshowState | null
  /**
   * Bumped when the current slideshow image is rewritten on disk (in-app editor Save)
   * so the overlay reloads even though the path is unchanged.
   */
  imageRevision: number
}

export function emptySlideshowSession(): SlideshowSession {
  return {
    cacheActive: false,
    imageListCache: [],
    categorizerMap: [],
    active: null,
    imageRevision: 0
  }
}

/** Effective playlist length (virtual compiled or flat paths). */
export function slideshowLength(a: SlideshowState): number {
  if (a.compiledMode) return a.compiledTotal ?? 0
  return a.paths.length
}

/** Current image path for overlay / categorizer. */
export function slideshowCurrentPath(a: SlideshowState): string | null {
  if (a.compiledMode) return a.currentPath ?? null
  return a.paths[a.index] ?? null
}
