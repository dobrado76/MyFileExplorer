import { useCallback, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { computePairActionAvailability } from '@shared/pairCompare/availability'
import { isRecycleBinTreePath } from '@shared/recycleBinTree'
import { ArrowLeft, ArrowRight, CloseIcon } from '../lib/icons'
import { useAppStore } from '../store/appStore'
import { usePairCompareStore } from './pairCompareStore'
import { PairFilterMenu } from './PairFilterMenu'
import { PairCompareOptionsPopover } from './PairCompareOptionsPopover'

type Props = {
  onColDrag: (deltaPx: number) => void
  onEqualize: () => void
}

function RailIcon({
  children,
  title,
  disabled,
  onClick,
  onMouseEnter,
  onMouseLeave,
  accent,
  buttonRef
}: {
  children: ReactNode
  title: string
  disabled?: boolean
  onClick: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  accent?: boolean
  buttonRef?: React.RefObject<HTMLButtonElement | null>
}): JSX.Element {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`pair-rail-btn${accent ? ' is-accent' : ''}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </button>
  )
}

function CompareIcon(): JSX.Element {
  return (
    <svg className="pair-rail-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M16 3h5v5M8 21H3v-5M21 3l-7 7M3 21l7-7" />
    </svg>
  )
}

function ChevronsRight(): JSX.Element {
  return (
    <svg className="pair-rail-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
    </svg>
  )
}

function ChevronsLeft(): JSX.Element {
  return (
    <svg className="pair-rail-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
    </svg>
  )
}

function SwapIcon(): JSX.Element {
  return (
    <svg className="pair-rail-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M12 8v8M9 11l3-3 3 3" />
    </svg>
  )
}

function TwoWayIcon(): JSX.Element {
  return (
    <svg className="pair-rail-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 3L4 7l4 4M4 7h10M16 21l4-4-4-4M20 17H10" />
    </svg>
  )
}

function FilterIcon(): JSX.Element {
  return (
    <svg className="pair-rail-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 5h16l-6 7v5l-4 2v-7L4 5z" />
    </svg>
  )
}

export function PairActionRail({ onColDrag, onEqualize }: Props): JSX.Element {
  const panes = useAppStore((s) => s.paneTabIds)
  const tabs = useAppStore((s) => s.tabs)
  const viewLayout = useAppStore((s) => s.viewLayout)
  const recycleActive = useAppStore((s) => s.recycleBin.active)
  const swapPanes = useAppStore((s) => s.swapPanes)
  const performTransfer = useAppStore((s) => s.performTransfer)
  const notify = useAppStore((s) => s.notify)

  const active = usePairCompareStore((s) => s.active)
  const scanning = usePairCompareStore((s) => s.scanning)
  const result = usePairCompareStore((s) => s.result)
  const selectedRowIds = usePairCompareStore((s) => s.selectedRowIds)
  const showOptions = usePairCompareStore((s) => s.showOptions)
  const setShowOptions = usePairCompareStore((s) => s.setShowOptions)
  const setHoverDirection = usePairCompareStore((s) => s.setHoverDirection)
  const startCompare = usePairCompareStore((s) => s.startCompare)
  const cancelCompare = usePairCompareStore((s) => s.cancelCompare)
  const exitComparison = usePairCompareStore((s) => s.exitComparison)
  const openSyncPlan = usePairCompareStore((s) => s.openSyncPlan)

  const [filterOpen, setFilterOpen] = useState(false)
  const compareBtnRef = useRef<HTMLButtonElement>(null)
  const filterBtnRef = useRef<HTMLButtonElement>(null)

  const leftTab = useMemo(() => {
    const id = panes[0]
    return id ? tabs.find((t) => t.id === id) : undefined
  }, [panes, tabs])
  const rightTab = useMemo(() => {
    const id = panes[1]
    return id ? tabs.find((t) => t.id === id) : undefined
  }, [panes, tabs])

  const avail = useMemo(
    () =>
      computePairActionAvailability({
        viewLayout,
        left: {
          hasTab: !!leftTab,
          path: leftTab?.path ?? null,
          searchActive: !!(leftTab?.search.active && leftTab.search.query.trim()),
          recycleActive: !!(recycleActive && isRecycleBinTreePath(leftTab?.path))
        },
        right: {
          hasTab: !!rightTab,
          path: rightTab?.path ?? null,
          searchActive: !!(rightTab?.search.active && rightTab.search.query.trim()),
          recycleActive: !!(recycleActive && isRecycleBinTreePath(rightTab?.path))
        }
      }),
    [viewLayout, leftTab, rightTab, recycleActive]
  )

  const leftPath = leftTab?.path ?? ''
  const rightPath = rightTab?.path ?? ''
  const leftName = leftPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || leftPath || 'left'
  const rightName = rightPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || rightPath || 'right'

  const compareTitle = scanning
    ? 'Stop comparison'
    : avail.canCompare
      ? `Compare\n${leftPath}\nwith\n${rightPath}`
      : (avail.disableReason ?? 'Compare unavailable')

  const onResizeDown = useCallback(
    (edge: 'left' | 'right') => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      let last = e.clientX
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      const move = (ev: PointerEvent): void => {
        const delta = ev.clientX - last
        last = ev.clientX
        // Left edge: drag right grows left pane; right edge: same (drag of boundary)
        onColDrag(edge === 'left' ? delta : delta)
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [onColDrag]
  )

  const copySelected = useCallback(
    async (dir: 'ltr' | 'rtl', planMode: boolean) => {
      if (!leftTab || !rightTab) return
      if (active && result) {
        const rows = result.rows.filter((r) => selectedRowIds.has(r.id))
        const sources =
          dir === 'ltr'
            ? rows.map((r) => r.left?.absolutePath).filter((p): p is string => !!p)
            : rows.map((r) => r.right?.absolutePath).filter((p): p is string => !!p)
        if (sources.length === 0) {
          notify('No real items on the source side of the selection', true)
          return
        }
        // Relative-path aware: copy each into dest parent under opposite root
        const destRoot = dir === 'ltr' ? result.rightRoot : result.leftRoot
        const byParent = new Map<string, string[]>()
        for (const row of rows) {
          const src = dir === 'ltr' ? row.left : row.right
          if (!src) continue
          const destAbs =
            destRoot.replace(/[/\\]+$/, '') +
            '\\' +
            row.relativePath.replace(/\//g, '\\')
          const parent = destAbs.includes('\\')
            ? destAbs.slice(0, destAbs.lastIndexOf('\\'))
            : destRoot
          const list = byParent.get(parent) ?? []
          list.push(src.absolutePath)
          byParent.set(parent, list)
        }
        for (const [parent, srcs] of byParent) {
          await performTransfer('copy', srcs, parent, false, planMode)
        }
        usePairCompareStore.getState().markStale()
        return
      }

      const sourceTab = dir === 'ltr' ? leftTab : rightTab
      const destTab = dir === 'ltr' ? rightTab : leftTab
      const sources = sourceTab.selected
      if (sources.length === 0) {
        notify('Nothing selected to copy', true)
        return
      }
      await performTransfer('copy', sources, destTab.path, false, planMode)
    },
    [active, result, selectedRowIds, leftTab, rightTab, performTransfer, notify]
  )

  const onSwap = useCallback(() => {
    const pair = usePairCompareStore.getState()
    swapPanes()
    if (pair.active && pair.result) {
      usePairCompareStore.setState({
        leftTabId: pair.rightTabId,
        rightTabId: pair.leftTabId,
        leftRestore: pair.rightRestore,
        rightRestore: pair.leftRestore,
        result: {
          ...pair.result,
          leftRoot: pair.result.rightRoot,
          rightRoot: pair.result.leftRoot,
          rows: pair.result.rows.map((r) => ({
            ...r,
            left: r.right,
            right: r.left,
            status:
              r.status === 'left_only'
                ? 'right_only'
                : r.status === 'right_only'
                  ? 'left_only'
                  : r.status === 'left_newer'
                    ? 'right_newer'
                    : r.status === 'right_newer'
                      ? 'left_newer'
                      : r.status
          }))
        }
      })
    }
  }, [swapPanes])

  const diffCount = result
    ? result.rows.filter((r) => r.status !== 'identical').length
    : 0

  const copyBlocked = avail.sameRoot || avail.nestedRoots || !avail.canCopyLeftToRight
  const syncBlocked = !avail.canSync || avail.sameRoot || avail.nestedRoots || !active || !result
  const leftSel = leftTab?.selected.length ?? 0
  const rightSel = rightTab?.selected.length ?? 0
  const pairSel = selectedRowIds.size
  const copyLtrDisabled =
    copyBlocked || (active ? pairSel === 0 && leftSel === 0 : leftSel === 0)
  const copyRtlDisabled =
    copyBlocked || (active ? pairSel === 0 && rightSel === 0 : rightSel === 0)

  return (
    <div
      className="pair-action-rail"
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        onEqualize()
      }}
    >
      <div className="pair-rail-edge left" onPointerDown={onResizeDown('left')} />
      <div className="pair-rail-edge right" onPointerDown={onResizeDown('right')} />

      <div className="pair-rail-stack">
        <RailIcon
          buttonRef={compareBtnRef}
          title={compareTitle}
          disabled={!scanning && !avail.canCompare}
          accent={active || showOptions}
          onClick={() => {
            if (scanning) void cancelCompare()
            else if (active && result) void startCompare()
            else {
              setFilterOpen(false)
              setShowOptions(!showOptions)
            }
          }}
        >
          <CompareIcon />
        </RailIcon>
        {showOptions ? <PairCompareOptionsPopover anchorRef={compareBtnRef} /> : null}

        <RailIcon
          buttonRef={filterBtnRef}
          title={
            active
              ? `Filter comparison results (${diffCount} differences)`
              : 'Filter — run Compare first'
          }
          disabled={!active || !result}
          onClick={() => {
            setShowOptions(false)
            setFilterOpen((v) => !v)
          }}
        >
          <span className="pair-rail-filter-glyph">
            <FilterIcon />
            {active && diffCount > 0 ? <span className="pair-rail-badge">{diffCount}</span> : null}
          </span>
        </RailIcon>
        {filterOpen && active ? (
          <PairFilterMenu anchorRef={filterBtnRef} onClose={() => setFilterOpen(false)} />
        ) : null}

        <div className="pair-rail-sep" />

        <RailIcon
          title={
            copyLtrDisabled
              ? leftSel === 0 && (!active || pairSel === 0)
                ? `Copy left → right — select items in ${leftName} first`
                : `Copy selected from left to right unavailable`
              : `Copy selected from left to right\n${leftPath}\n→\n${rightPath}`
          }
          disabled={copyLtrDisabled}
          onClick={() => void copySelected('ltr', false)}
          onMouseEnter={() => setHoverDirection('ltr')}
          onMouseLeave={() => setHoverDirection(null)}
        >
          <ArrowRight />
        </RailIcon>
        <RailIcon
          title={
            copyRtlDisabled
              ? rightSel === 0 && (!active || pairSel === 0)
                ? `Copy right → left — select items in ${rightName} first`
                : `Copy selected from right to left unavailable`
              : `Copy selected from right to left\n${rightPath}\n→\n${leftPath}`
          }
          disabled={copyRtlDisabled}
          onClick={() => void copySelected('rtl', false)}
          onMouseEnter={() => setHoverDirection('rtl')}
          onMouseLeave={() => setHoverDirection(null)}
        >
          <ArrowLeft />
        </RailIcon>

        <div className="pair-rail-sep" />

        <RailIcon
          title={
            syncBlocked
              ? !active || !result
                ? 'Synchronize — run Compare first'
                : 'Synchronize unavailable'
              : `Synchronize right from left\n${leftPath}\n→\n${rightPath}`
          }
          disabled={syncBlocked}
          onClick={() => void openSyncPlan('left_to_right', 'update')}
          onMouseEnter={() => setHoverDirection('ltr')}
          onMouseLeave={() => setHoverDirection(null)}
        >
          <ChevronsRight />
        </RailIcon>
        <RailIcon
          title={
            syncBlocked
              ? !active || !result
                ? 'Synchronize — run Compare first'
                : 'Synchronize unavailable'
              : `Synchronize left from right\n${rightPath}\n→\n${leftPath}`
          }
          disabled={syncBlocked}
          onClick={() => void openSyncPlan('right_to_left', 'update')}
          onMouseEnter={() => setHoverDirection('rtl')}
          onMouseLeave={() => setHoverDirection(null)}
        >
          <ChevronsLeft />
        </RailIcon>
        <RailIcon
          title={
            syncBlocked
              ? !active || !result
                ? 'Two-way reconcile — run Compare first'
                : 'Two-way reconcile unavailable'
              : `Two-way reconcile\n${leftPath}\n↔\n${rightPath}`
          }
          disabled={syncBlocked}
          onClick={() => void openSyncPlan('two_way', 'update')}
        >
          <TwoWayIcon />
        </RailIcon>

        <div className="pair-rail-sep" />

        <RailIcon
          title="Swap panes — does not move files"
          disabled={!avail.canSwap}
          onClick={onSwap}
        >
          <SwapIcon />
        </RailIcon>

        {active ? (
          <RailIcon title="Exit comparison" onClick={() => void exitComparison()}>
            <CloseIcon />
          </RailIcon>
        ) : null}

        {avail.disableReason && !avail.canCompare ? (
          <div className="pair-rail-hint" title={avail.disableReason}>
            !
          </div>
        ) : null}
      </div>
    </div>
  )
}
