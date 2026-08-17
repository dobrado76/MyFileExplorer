import {
  matchesMediaLibraryFilter,
  type MediaLibraryItemFlags,
  type MediaWatchedFilter
} from '@shared/mediaMetadata'

export function isExcludedByMediaLibrary(
  path: string,
  lib: {
    isContainer: boolean
    items: Record<string, MediaLibraryItemFlags>
    watchedFilter: MediaWatchedFilter
    genreFilter: string | null
  }
): boolean {
  if (!lib.isContainer) return false
  if (lib.watchedFilter === 'all' && !lib.genreFilter) return false
  return !matchesMediaLibraryFilter(lib.items[path.toLowerCase()], lib.watchedFilter, lib.genreFilter)
}
