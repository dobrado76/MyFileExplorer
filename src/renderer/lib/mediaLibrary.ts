import {
  matchesMediaLibraryFilter,
  mediaContainerIgnoresFoldersFirst,
  type MediaLibraryItemFlags,
  type MediaWatchedFilter
} from '@shared/mediaMetadata'
import { samePath } from '@shared/paths'

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

/** Folders-first for the current file list (media libraries can mix tiles). */
export function listingFoldersFirst(opts: {
  foldersFirst: boolean
  mediaEnabled: boolean
  mixFilesAndFolders: boolean
  isContainer: boolean
  listingPath: string
  containerPath: string
}): boolean {
  if (
    mediaContainerIgnoresFoldersFirst(opts.mediaEnabled, opts.mixFilesAndFolders, opts.isContainer) &&
    opts.listingPath &&
    opts.containerPath &&
    samePath(opts.listingPath, opts.containerPath)
  ) {
    return false
  }
  return opts.foldersFirst
}
