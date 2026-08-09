import { useMemo, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { compileViewFilter } from '../lib/viewFilter'
import { SpinnerIcon } from '../lib/icons'

/** Banner above the file view while a search session is active. */
export function SearchBanner(): JSX.Element | null {
  const search = useAppStore((s) => s.search)
  const clearSearch = useAppStore((s) => s.clearSearch)
  const viewFilterEnabled = useAppStore((s) => s.settings.viewFilterEnabled)
  const viewFilterPatterns = useAppStore((s) => s.settings.viewFilterPatterns)

  const visibleCount = useMemo(() => {
    const isHidden = compileViewFilter(viewFilterPatterns, viewFilterEnabled)
    return search.results.filter((r) => !isHidden(r.path)).length
  }, [search.results, viewFilterEnabled, viewFilterPatterns])

  if (!search.active) return null

  const hidden = search.results.length - visibleCount

  return (
    <div className="search-banner">
      {search.running ? (
        <>
          <SpinnerIcon size={14} className="spin" />
          <span>Searching… {search.progress ?? ''}</span>
          <button type="button" onClick={clearSearch}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <span>
            {visibleCount} result{visibleCount === 1 ? '' : 's'} for “{search.query}”
            {search.partial ? ' (truncated)' : ''}
            {hidden > 0 ? ` · ${hidden} hidden by view filter` : ''}
          </span>
          {search.source === 'walk' && (
            <span className="banner-warn">Not indexed — slow search</span>
          )}
          {search.contentSlow && (
            <span className="banner-warn">Content search — slow</span>
          )}
          {search.source === 'index' && !search.contentSlow && (
            <span className="banner-ok">Indexed</span>
          )}
          <button type="button" onClick={clearSearch}>
            Clear
          </button>
        </>
      )}
    </div>
  )
}
