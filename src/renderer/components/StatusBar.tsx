import { useMemo, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { formatBytes } from '../lib/format'
import { isExcludedByViewFilter } from '../lib/viewFilter'

function fileOpTitle(kind: string, label?: string): string {
  if (label) return label.replace(/…$/, '')
  switch (kind) {
    case 'copy':
      return 'Copying'
    case 'move':
    case 'relocate':
      return 'Moving'
    case 'trash':
      return 'Recycle Bin'
    case 'delete':
      return 'Deleting'
    case 'vid-thumbs':
      return 'Video previews'
    default:
      return 'Working'
  }
}

export function StatusBar(): JSX.Element {
  const listing = useAppStore((s) => s.listing)
  const selected = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.selected ?? [])
  const notice = useAppStore((s) => s.notice)
  const search = useAppStore((s) => s.search)
  const indexProgress = useAppStore((s) => s.indexProgress)
  const indexRoots = useAppStore((s) => s.indexRoots)
  const settings = useAppStore((s) => s.settings)
  const fileOp = useAppStore((s) => s.fileOp)

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

  const opPct =
    fileOp && fileOp.total > 0
      ? Math.min(100, Math.round((fileOp.done / fileOp.total) * 100))
      : fileOp
        ? 0
        : null

  return (
    <div className="statusbar">
      {fileOp ? (
        <div className="status-op" role="status" aria-live="polite">
          <span className="status-op-label">
            {fileOpTitle(fileOp.kind, fileOp.label)}
            {fileOp.total > 0
              ? ` ${Math.min(fileOp.done, fileOp.total)} of ${fileOp.total}`
              : '…'}
            {fileOp.current ? ` — ${fileOp.current}` : ''}
          </span>
          <div
            className="status-op-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={opPct ?? 0}
            aria-label={fileOpTitle(fileOp.kind, fileOp.label)}
          >
            <div
              className={`status-op-fill${fileOp.total <= 0 ? ' indeterminate' : ''}`}
              style={fileOp.total > 0 ? { width: `${opPct}%` } : undefined}
            />
          </div>
        </div>
      ) : search.active ? (
        <span>{search.results.length} search results</span>
      ) : (
        <span>
          {listing.loading
            ? 'Loading…'
            : `${listing.entries.length - hiddenCount} item${listing.entries.length - hiddenCount === 1 ? '' : 's'}${hiddenCount > 0 ? ` (${hiddenCount} hidden by filter)` : ''}`}
        </span>
      )}
      {!fileOp && selected.length > 0 && (
        <span>
          {selected.length} selected{selectionSize > 0 ? ` · ${formatBytes(selectionSize)}` : ''}
        </span>
      )}
      {!fileOp && indexingRoot && (
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
