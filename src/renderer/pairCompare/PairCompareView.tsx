import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { PairCompareRow, PairCompareStatus } from '@shared/pairCompare/types'
import { useAppStore } from '../store/appStore'
import { FolderIcon, FileIcon } from '../lib/icons'
import { usePairCompareStore, visiblePairRows } from './pairCompareStore'

const ROW_H = 28

function statusGlyph(status: PairCompareStatus): string {
  switch (status) {
    case 'identical':
      return '✓'
    case 'left_only':
      return '+'
    case 'right_only':
      return '+'
    case 'left_newer':
      return '→'
    case 'right_newer':
      return '←'
    case 'different':
      return '≠'
    case 'type_conflict':
      return '⚠'
    case 'inaccessible':
    case 'error':
      return '⛔'
    default:
      return '·'
  }
}

function formatSize(n: number | null | undefined): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

type Props = {
  side: 'left' | 'right'
}

export function PairCompareView({ side }: Props): JSX.Element {
  const result = usePairCompareStore((s) => s.result)
  const scanning = usePairCompareStore((s) => s.scanning)
  const progressLabel = usePairCompareStore((s) => s.progressLabel)
  const stale = usePairCompareStore((s) => s.stale)
  const selectedRowIds = usePairCompareStore((s) => s.selectedRowIds)
  const lastClickedSide = usePairCompareStore((s) => s.lastClickedSide)
  const scrollOffset = usePairCompareStore((s) => s.scrollOffset)
  const setScrollOffset = usePairCompareStore((s) => s.setScrollOffset)
  const toggleRow = usePairCompareStore((s) => s.toggleRow)
  const hoverDirection = usePairCompareStore((s) => s.hoverDirection)
  const startCompare = usePairCompareStore((s) => s.startCompare)
  const exitComparison = usePairCompareStore((s) => s.exitComparison)
  const visibleStatuses = usePairCompareStore((s) => s.visibleStatuses)
  const sortKey = usePairCompareStore((s) => s.sortKey)
  const sortDir = usePairCompareStore((s) => s.sortDir)
  const setSelection = useAppStore((s) => s.setSelection)

  const rows = useMemo(
    () =>
      visiblePairRows({
        result,
        visibleStatuses,
        sortKey,
        sortDir
      }),
    [result, visibleStatuses, sortKey, sortDir]
  )
  const parentRef = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12
  })

  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    if (Math.abs(el.scrollTop - scrollOffset) > 2) {
      syncing.current = true
      el.scrollTop = scrollOffset
      requestAnimationFrame(() => {
        syncing.current = false
      })
    }
  }, [scrollOffset, side])

  const onScroll = useCallback((): void => {
    if (syncing.current) return
    const el = parentRef.current
    if (!el) return
    setScrollOffset(el.scrollTop)
  }, [setScrollOffset])

  const root = side === 'left' ? result?.leftRoot : result?.rightRoot
  const method = result?.options.compareMethod ?? 'size_mtime'

  const onRowClick = (row: PairCompareRow, e: React.MouseEvent): void => {
    toggleRow(row.id, side, e.ctrlKey || e.metaKey)
    const entry = side === 'left' ? row.left : row.right
    if (entry) setSelection([entry.absolutePath], entry.absolutePath, entry.absolutePath)
    else setSelection([])
  }

  const highlight =
    hoverDirection === 'ltr'
      ? side === 'left'
        ? 'pair-pane-source'
        : 'pair-pane-dest'
      : hoverDirection === 'rtl'
        ? side === 'right'
          ? 'pair-pane-source'
          : 'pair-pane-dest'
        : ''

  return (
    <div className={`pair-compare-view ${highlight}`.trim()}>
      <div className="pair-compare-header">
        <span className="pair-compare-header-main">
          Compared root: <strong title={root ?? ''}>{root ?? '—'}</strong>
          {' · '}
          {rows.length.toLocaleString()} items
        </span>
        <span className="pair-compare-header-meta">
          {method.replace(/_/g, ' ')}
          {stale ? ' · Results may be stale' : ''}
        </span>
        <span className="pair-compare-header-actions">
          <button type="button" className="btn ghost" onClick={() => void startCompare()}>
            Recompare
          </button>
          <button type="button" className="btn ghost" onClick={() => void exitComparison()}>
            Exit
          </button>
        </span>
      </div>

      {scanning ? (
        <div className="pair-compare-busy">{progressLabel ?? 'Comparing…'}</div>
      ) : null}

      <div className="pair-compare-cols">
        <span className="pair-col status">St</span>
        <span className="pair-col name">Name</span>
        <span className="pair-col folder">Relative folder</span>
        <span className="pair-col size">Size</span>
        <span className="pair-col modified">Modified</span>
      </div>

      <div className="pair-compare-scroll" ref={parentRef} onScroll={onScroll}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = rows[v.index]!
            const entry = side === 'left' ? row.left : row.right
            const ghost = !entry
            const selected = selectedRowIds.has(row.id)
            const strong = selected && lastClickedSide === side
            const name = entry
              ? entry.relativePath.replace(/\\/g, '/').split('/').pop() ?? entry.relativePath
              : row.relativePath.replace(/\\/g, '/').split('/').pop() ?? row.relativePath
            const folder = (() => {
              const rel = row.relativePath.replace(/\\/g, '/')
              const i = rel.lastIndexOf('/')
              return i > 0 ? rel.slice(0, i) : ''
            })()
            const isDir =
              entry?.kind === 'directory' ||
              entry?.kind === 'junction' ||
              (!entry &&
                (row.left?.kind === 'directory' ||
                  row.right?.kind === 'directory' ||
                  row.left?.kind === 'junction' ||
                  row.right?.kind === 'junction'))

            return (
              <div
                key={row.id}
                className={`pair-compare-row status-${row.status}${selected ? ' selected' : ''}${strong ? ' clicked-side' : ''}${ghost ? ' ghost' : ''}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: ROW_H,
                  transform: `translateY(${v.start}px)`
                }}
                onClick={(e) => onRowClick(row, e)}
                role="row"
                aria-selected={selected}
                title={row.reason}
              >
                <span className="pair-col status" aria-label={row.status}>
                  {statusGlyph(row.status)}
                </span>
                <span className="pair-col name">
                  {ghost ? (
                    <em className="pair-missing">Missing — {name}</em>
                  ) : (
                    <>
                      {isDir ? <FolderIcon size={14} /> : <FileIcon size={14} />}
                      <span>{name}</span>
                    </>
                  )}
                </span>
                <span className="pair-col folder" title={folder}>
                  {folder}
                </span>
                <span className="pair-col size">{ghost ? '' : formatSize(entry?.size)}</span>
                <span className="pair-col modified">
                  {ghost || entry?.modifiedMs == null
                    ? ''
                    : new Date(entry.modifiedMs).toLocaleString()}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
