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
  paths: string[]
  index: number
  builtFromCache: boolean
  /** Progress while building */
  buildFound: number
  buildCurrent: string
  actions: SlideshowAction[]
  /** Playing from compiled !!Lists / .dat indexes. */
  compiledMode?: boolean
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
