import { useMemo, useRef, type JSX } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAppStore } from '../store/appStore'
import { parentOf } from '../lib/paths'
import { formatBytes, formatDate } from '../lib/format'
import { compileViewFilter } from '../lib/viewFilter'
import { SpinnerIcon, isImageExt } from '../lib/icons'
import { basename } from '../lib/paths'
import { ShellIcon } from './ShellIcon'

function extOf(path: string): string {
  const name = basename(path)
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function SearchResults(): JSX.Element {
  const search = useAppStore((s) => s.search)
  const clearSearch = useAppStore((s) => s.clearSearch)
  const navigate = useAppStore((s) => s.navigate)
  const setSelection = useAppStore((s) => s.setSelection)
  const openPath = useAppStore((s) => s.openPath)
  const openImageViewer = useAppStore((s) => s.openImageViewer)
  const settings = useAppStore((s) => s.settings)

  const results = useMemo(() => {
    const isHidden = compileViewFilter(settings.viewFilterPatterns, settings.viewFilterEnabled)
    return search.results.filter((r) => !isHidden(r.path))
  }, [search.results, settings.viewFilterPatterns, settings.viewFilterEnabled])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 10
  })

  const openResult = async (path: string, isDir: boolean): Promise<void> => {
    if (isDir) {
      await navigate(path)
      return
    }
    if (isImageExt(extOf(path))) {
      openImageViewer(path, [path])
      return
    }
    const parent = parentOf(path)
    if (parent) {
      await navigate(parent)
      setSelection([path], path, path)
    }
  }

  return (
    <>
      <div className="search-banner">
        {search.running ? (
          <>
            <SpinnerIcon size={14} className="spin" />
            <span>Searching… {search.progress ?? ''}</span>
            <button onClick={clearSearch}>Cancel</button>
          </>
        ) : (
          <>
            <span>
              {results.length} result{results.length === 1 ? '' : 's'} for “{search.query}”
              {search.partial ? ' (truncated)' : ''}
              {results.length < search.results.length
                ? ` · ${search.results.length - results.length} hidden by view filter`
                : ''}
            </span>
            {search.source === 'walk' && (
              <span className="banner-warn">Not indexed — slow search</span>
            )}
            <button onClick={clearSearch}>Clear</button>
          </>
        )}
      </div>
      <div ref={scrollRef} className="fileview" role="listbox" aria-label="Search results">
        {!search.running && results.length === 0 && <div className="fileview-empty">No results</div>}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const item = results[v.index]
            if (!item) return null
            return (
              <div
                key={item.path}
                className="row"
                style={{ top: v.start, height: 44 }}
                onDoubleClick={() => void openResult(item.path, item.isDir)}
                onClick={(e) => {
                  if (e.detail === 1) void 0
                }}
                title={item.path}
              >
                <div className="row-name">
                  <ShellIcon path={item.path} size={18} isDir={item.isDir} />
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span>{item.name}</span>
                    <span className="search-result-path">{item.path}</span>
                  </span>
                </div>
                <span className="col col-mtime">{formatDate(item.mtimeMs)}</span>
                <span className="col col-size">{item.isDir ? '' : formatBytes(item.size)}</span>
                <button
                  className="col"
                  style={{ color: 'var(--accent)' }}
                  onClick={() => void openPath(item.path)}
                  title="Open with default app"
                >
                  Open
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
