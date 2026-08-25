import { useMemo, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { isExcludedByViewFilter } from '../lib/viewFilter'

type Props = {
  /** Pane this banner belongs to. Results stay on that tab while you work in another pane. */
  paneIndex: number
}

/** Banner above the file view while that pane’s tab has an active search. */
export function SearchBanner({ paneIndex }: Props): JSX.Element | null {
  const tabId = useAppStore((s) => s.paneTabIds[paneIndex] ?? null)
  const search = useAppStore((s) => {
    if (!tabId) return null
    return s.tabs.find((t) => t.id === tabId)?.search ?? null
  })
  const clearSearch = useAppStore((s) => s.clearSearch)
  const viewFilterEnabled = useAppStore((s) => s.settings.viewFilterEnabled)
  const viewFilterPatterns = useAppStore((s) => s.settings.viewFilterPatterns)
  const searchShowHidden = useAppStore((s) => s.settings.searchShowHidden)

  const visibleCount = useMemo(() => {
    if (!search) return 0
    // Show hidden ON → every hit. OFF → same view-filter rules as the file list (if eye on).
    if (searchShowHidden || !viewFilterEnabled) return search.results.length
    return search.results.filter(
      (r) =>
        !isExcludedByViewFilter(
          { path: r.path, isHidden: r.isHidden === true },
          viewFilterPatterns,
          true
        )
    ).length
  }, [search, searchShowHidden, viewFilterEnabled, viewFilterPatterns])

  if (!search?.active || search.running) return null

  const hidden = search.results.length - visibleCount

  return (
    <div className="search-banner">
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
      <button type="button" onClick={() => clearSearch(tabId ?? undefined)}>
        Clear
      </button>
    </div>
  )
}
