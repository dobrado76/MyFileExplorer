import { useCallback, useRef, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { ExplorerPane } from './ExplorerPane'
import { Splitter } from './Splitter'
import { SearchBanner } from './SearchBanner'
import { RecycleBinBanner } from './RecycleBinBanner'

export function ViewGrid(): JSX.Element {
  const viewLayout = useAppStore((s) => s.viewLayout)
  const paneSplitCols = useAppStore((s) => s.paneSplitCols)
  const paneSplitRows = useAppStore((s) => s.paneSplitRows)
  const setPaneSplitCols = useAppStore((s) => s.setPaneSplitCols)
  const setPaneSplitRows = useAppStore((s) => s.setPaneSplitRows)
  const focusedPaneIndex = useAppStore((s) => s.focusedPaneIndex)
  const gridRef = useRef<HTMLDivElement>(null)

  // Read live ratios from the store — Splitter keeps the pointerdown-era onDrag
  // for the whole gesture, so a closed-over paneSplitCols would stick after one step.
  const onColDrag = useCallback(
    (delta: number): void => {
      const el = gridRef.current
      if (!el) return
      const w = el.clientWidth
      if (w < 40) return
      const cur = useAppStore.getState().paneSplitCols
      setPaneSplitCols(cur + delta / w)
    },
    [setPaneSplitCols]
  )

  const onRowDrag = useCallback(
    (delta: number): void => {
      const el = gridRef.current
      if (!el) return
      const h = el.clientHeight
      if (h < 40) return
      const cur = useAppStore.getState().paneSplitRows
      setPaneSplitRows(cur + delta / h)
    },
    [setPaneSplitRows]
  )

  if (viewLayout === 1) {
    return (
      <div className="view-grid layout-1" ref={gridRef}>
        <div className="view-grid-cell">
          {focusedPaneIndex === 0 && <RecycleBinBanner />}
          <SearchBanner paneIndex={0} />
          <ExplorerPane paneIndex={0} />
        </div>
      </div>
    )
  }

  if (viewLayout === 2) {
    const leftPct = paneSplitCols * 100
    return (
      <div className="view-grid layout-2" ref={gridRef}>
        <div className="view-grid-cell" style={{ flex: `0 0 ${leftPct}%` }}>
          {focusedPaneIndex === 0 && <RecycleBinBanner />}
          <SearchBanner paneIndex={0} />
          <ExplorerPane paneIndex={0} />
        </div>
        <Splitter onDrag={onColDrag} />
        <div className="view-grid-cell" style={{ flex: '1 1 0', minWidth: 0 }}>
          {focusedPaneIndex === 1 && <RecycleBinBanner />}
          <SearchBanner paneIndex={1} />
          <ExplorerPane paneIndex={1} />
        </div>
      </div>
    )
  }

  // 2×2
  const colPct = paneSplitCols * 100
  const rowPct = paneSplitRows * 100
  return (
    <div className="view-grid layout-4" ref={gridRef}>
      <div className="view-grid-row" style={{ flex: `0 0 ${rowPct}%` }}>
        <div className="view-grid-cell" style={{ flex: `0 0 ${colPct}%` }}>
          {focusedPaneIndex === 0 && <RecycleBinBanner />}
          <SearchBanner paneIndex={0} />
          <ExplorerPane paneIndex={0} />
        </div>
        <Splitter onDrag={onColDrag} />
        <div className="view-grid-cell" style={{ flex: '1 1 0', minWidth: 0 }}>
          {focusedPaneIndex === 1 && <RecycleBinBanner />}
          <SearchBanner paneIndex={1} />
          <ExplorerPane paneIndex={1} />
        </div>
      </div>
      <Splitter orientation="horizontal" onDrag={onRowDrag} />
      <div className="view-grid-row" style={{ flex: '1 1 0', minHeight: 0 }}>
        <div className="view-grid-cell" style={{ flex: `0 0 ${colPct}%` }}>
          {focusedPaneIndex === 2 && <RecycleBinBanner />}
          <SearchBanner paneIndex={2} />
          <ExplorerPane paneIndex={2} />
        </div>
        <Splitter onDrag={onColDrag} />
        <div className="view-grid-cell" style={{ flex: '1 1 0', minWidth: 0 }}>
          {focusedPaneIndex === 3 && <RecycleBinBanner />}
          <SearchBanner paneIndex={3} />
          <ExplorerPane paneIndex={3} />
        </div>
      </div>
    </div>
  )
}
