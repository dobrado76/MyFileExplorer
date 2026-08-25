import type { CategorizerMapRow } from '@shared/slideshow/categorizerMap'
import {
  folderPathAt,
  folderPlaylistLiveLength,
  folderPlaylistPhysicalLength
} from './folderPlaylist'

export {
  slideshowFirstIndex,
  slideshowLastIndex,
  slideshowLength,
  slideshowNextIndex
} from '@shared/slideshow/playlist'

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

/**
 * Reactive slideshow cursor. Folder/cache path bytes live in `folderPlaylist`
 * (module scope) — never put a large `paths[]` here.
 */
export type SlideshowState = {
  status: SlideshowStatus
  index: number
  /** Resolved path for `index` (folder module or compiled IPC). */
  currentPath: string | null
  /** Physical playlist length (folder module / compiledTotal). */
  pathCount: number
  builtFromCache: boolean
  /** Progress while building */
  buildFound: number
  buildCurrent: string
  actions: SlideshowAction[]
  /** Playing from compiled !!Lists / .dat indexes (virtual playlist in main). */
  compiledMode?: boolean
  /** Logical length of virtual compiled playlist (C# int scale). */
  compiledTotal?: number
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

/** Current image path for overlay / categorizer. */
export function slideshowCurrentPath(a: SlideshowState): string | null {
  if (a.compiledMode) return a.currentPath ?? null
  return a.currentPath ?? folderPathAt(a.index)
}

/** Live (unskipped) length for UI / empty checks. */
export function slideshowLiveLength(a: SlideshowState): number {
  if (a.compiledMode) return a.compiledTotal ?? 0
  return folderPlaylistLiveLength()
}

export function slideshowPhysicalLength(a: SlideshowState): number {
  if (a.compiledMode) return a.compiledTotal ?? 0
  return a.pathCount || folderPlaylistPhysicalLength()
}
