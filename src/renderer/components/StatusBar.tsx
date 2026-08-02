import { useMemo, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { formatBytes } from '../lib/format'
import { isExcludedByViewFilter } from '../lib/viewFilter'

export function StatusBar(): JSX.Element {
  const listing = useAppStore((s) => s.listing)
  const selected = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.selected ?? [])
  const notice = useAppStore((s) => s.notice)
  const search = useAppStore((s) => s.search)
  const indexProgress = useAppStore((s) => s.indexProgress)
  const indexRoots = useAppStore((s) => s.indexRoots)
  const settings = useAppStore((s) => s.settings)

  const hiddenCount = useMemo(() => {
    let hidden = 0
    for (const e of listing.entries) {
      if (isExcludedByViewFilter(e, settings.viewFilterPatterns, settings.viewFilterEnabled)) {
        hidden++
      }
    }
    return hidden
  }, [listing.entries, settings.viewFilterPatterns, settings.viewFilterEnabled])

  const selectionSize = useMemo(() => {
    if (selected.length === 0) return 0
    const sel = new Set(selected.map((p) => p.toLowerCase()))
    let total = 0
    for (const e of listing.entries) {
      if (e.kind !== 'dir' && sel.has(e.path.toLowerCase())) total += e.size
    }
    return total
  }, [selected, listing.entries])

  const indexingRoot = indexRoots.find((r) => r.status === 'indexing')

  return (
    <div className="statusbar">
      {search.active ? (
        <span>{search.results.length} search results</span>
      ) : (
        <span>
          {listing.loading
            ? 'Loading…'
            : `${listing.entries.length - hiddenCount} item${listing.entries.length - hiddenCount === 1 ? '' : 's'}${hiddenCount > 0 ? ` (${hiddenCount} hidden by filter)` : ''}`}
        </span>
      )}
      {selected.length > 0 && (
        <span>
          {selected.length} selected{selectionSize > 0 ? ` · ${formatBytes(selectionSize)}` : ''}
        </span>
      )}
      {indexingRoot && (
        <span>
          Indexing {indexingRoot.path}… {indexProgress[indexingRoot.path] ?? 0} entries
        </span>
      )}
      {notice && (
        <span className={`status-notice${notice.isError ? ' error' : ''}`}>{notice.text}</span>
      )}
    </div>
  )
}
