import { useMemo, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { samePath } from '../lib/paths'

export function MediaLibraryToolbar(): JSX.Element | null {
  const enabled = useAppStore((s) => s.settings.mediaMetadata.enabled)
  const listingPath = useAppStore((s) => s.listing.path)
  const lib = useAppStore((s) => s.mediaLibrary)
  const setWatchedFilter = useAppStore((s) => s.setMediaLibraryWatchedFilter)
  const setGenreFilter = useAppStore((s) => s.setMediaLibraryGenreFilter)

  const genres = useMemo(() => {
    const set = new Set<string>()
    for (const it of Object.values(lib.items)) {
      for (const g of it.genres) {
        if (g.trim()) set.add(g)
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [lib.items])

  if (!enabled || !lib.isContainer || !listingPath || !samePath(listingPath, lib.folderPath)) {
    return null
  }

  return (
    <div className="toolbar-edit" role="group" aria-label="Media library">
      <span className="toolbar-sep" aria-hidden />
      <label className="toolbar-media-label" htmlFor="toolbar-media-watched">
        <span className="toolbar-media-caption">Watched</span>
        <select
          id="toolbar-media-watched"
          className="toolbar-remote-select toolbar-media-select"
          value={lib.watchedFilter}
          onChange={(e) =>
            setWatchedFilter(e.target.value as 'all' | 'watched' | 'unwatched')
          }
          aria-label="Filter watched"
        >
          <option value="all">All</option>
          <option value="unwatched">Unwatched</option>
          <option value="watched">Watched</option>
        </select>
      </label>
      <label className="toolbar-media-label" htmlFor="toolbar-media-genre">
        <span className="toolbar-media-caption">Genre</span>
        <select
          id="toolbar-media-genre"
          className="toolbar-remote-select toolbar-media-select"
          value={lib.genreFilter ?? ''}
          onChange={(e) => setGenreFilter(e.target.value || null)}
          aria-label="Filter genre"
        >
          <option value="">All genres</option>
          {genres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
