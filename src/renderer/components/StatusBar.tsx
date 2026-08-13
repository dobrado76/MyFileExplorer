import { useMemo, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { formatBytes } from '../lib/format'
import { isExcludedByViewFilter } from '../lib/viewFilter'
import { searchResultsToEntries } from '../lib/searchEntries'
import { recycleBinItemsToEntries } from '../lib/recycleBinEntries'
import { api } from '../lib/ipc'

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
    case 'zip':
      return 'Compressing'
    case 'compile-lists':
      return 'Updating Lists'
    case 'folder-stats':
      return 'Folder statistics'
    default:
      return 'Working'
  }
}

export function StatusBar(): JSX.Element {
  const listing = useAppStore((s) => s.listing)
  const selected = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.selected ?? [])
  const notice = useAppStore((s) => s.notice)
  const search = useAppStore((s) => s.search)
  const recycleBin = useAppStore((s) => s.recycleBin)
  const indexProgress = useAppStore((s) => s.indexProgress)
  const indexRoots = useAppStore((s) => s.indexRoots)
  const settings = useAppStore((s) => s.settings)
  const fileOp = useAppStore((s) => s.fileOp)
  const notify = useAppStore((s) => s.notify)

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
    const pool = recycleBin.active
      ? recycleBinItemsToEntries(recycleBin.items)
      : search.active
        ? searchResultsToEntries(search.results)
        : listing.entries
    let total = 0
    for (const e of pool) {
      if (e.kind !== 'dir' && sel.has(e.path.toLowerCase())) total += e.size
    }
    return total
  }, [
    selected,
    listing.entries,
    search.active,
    search.results,
    recycleBin.active,
    recycleBin.items
  ])

  const indexingRoot = indexRoots.find((r) => r.status === 'indexing')

  const hasBytes =
    fileOp != null &&
    fileOp.bytesTotal != null &&
    fileOp.bytesTotal > 0 &&
    fileOp.bytesDone != null
  const indeterminate =
    !!fileOp && (fileOp.total <= 0 || (fileOp.done === 0 && !hasBytes))
  const opPct = !fileOp
    ? null
    : hasBytes
      ? Math.min(100, Math.round((fileOp.bytesDone! / fileOp.bytesTotal!) * 100))
      : fileOp.total > 0
        ? Math.min(100, Math.round((fileOp.done / fileOp.total) * 100))
        : 0

  const opCounts =
    fileOp == null
      ? ''
      : fileOp.total > 0
        ? `${Math.min(fileOp.done, fileOp.total).toLocaleString()} of ${fileOp.total.toLocaleString()}`
        : fileOp.done > 0
          ? `${fileOp.done.toLocaleString()} scanned`
          : '…'

  let opCurrent = ''
  if (fileOp?.current) opCurrent = fileOp.current
  if (fileOp && hasBytes && fileOp.bytesTotal! > 0) {
    opCurrent =
      (opCurrent ? `${opCurrent} · ` : '') +
      `${formatBytes(fileOp.bytesDone!)} / ${formatBytes(fileOp.bytesTotal!)}`
  }

  const itemCountLabel = recycleBin.active
    ? recycleBin.loading
      ? 'Loading Recycle Bin…'
      : `${recycleBin.items.length} item${recycleBin.items.length === 1 ? '' : 's'} in Recycle Bin`
    : search.active
      ? `${search.results.length} search result${search.results.length === 1 ? '' : 's'}`
      : listing.loading
        ? 'Loading…'
        : `${listing.entries.length - hiddenCount} item${listing.entries.length - hiddenCount === 1 ? '' : 's'}${hiddenCount > 0 ? ` (${hiddenCount} hidden by filter)` : ''}`

  return (
    <div className="statusbar">
      {fileOp ? (
        <div className="status-op" role="status" aria-live="polite">
          <div
            className="status-op-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={indeterminate ? undefined : (opPct ?? 0)}
            aria-label={fileOpTitle(fileOp.kind, fileOp.label)}
          >
            <div
              className={`status-op-fill${indeterminate ? ' indeterminate' : ''}`}
              style={!indeterminate ? { width: `${opPct}%` } : undefined}
            />
          </div>
          <span className="status-op-title">{fileOpTitle(fileOp.kind, fileOp.label)}</span>
          {opCounts ? <span className="status-op-counts">{opCounts}</span> : null}
          {opCurrent ? (
            <span className="status-op-current" title={opCurrent}>
              {opCurrent}
            </span>
          ) : null}
          <button
            type="button"
            className="status-op-cancel"
            onClick={() => {
              void api.fs.cancelOp().then((res) => {
                if (res.ok && res.value.cancelled) notify('Cancelling…')
              })
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <span>{itemCountLabel}</span>
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
