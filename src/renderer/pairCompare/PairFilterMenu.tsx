import { useEffect, useLayoutEffect, useState, type JSX, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { PairCompareStatus } from '@shared/pairCompare/types'
import { usePairCompareStore } from './pairCompareStore'

const OPTIONS: { id: PairCompareStatus | 'differences'; label: string }[] = [
  { id: 'differences', label: 'Differences only' },
  { id: 'identical', label: 'Identical' },
  { id: 'left_only', label: 'Left only' },
  { id: 'right_only', label: 'Right only' },
  { id: 'left_newer', label: 'Left newer' },
  { id: 'right_newer', label: 'Right newer' },
  { id: 'different', label: 'Different' },
  { id: 'type_conflict', label: 'Conflicts / errors' }
]

type Props = {
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
}

export function PairFilterMenu({ onClose, anchorRef }: Props): JSX.Element | null {
  const result = usePairCompareStore((s) => s.result)
  const visible = usePairCompareStore((s) => s.visibleStatuses)
  const setVisibleStatuses = usePairCompareStore((s) => s.setVisibleStatuses)
  const selectByStatus = usePairCompareStore((s) => s.selectByStatus)
  const clearSelection = usePairCompareStore((s) => s.clearSelection)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const place = (): void => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const width = 280
      let left = r.right + 6
      if (left + width > window.innerWidth - 8) left = Math.max(8, r.left - width - 6)
      let top = r.top
      if (top + 360 > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 360)
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchorRef])

  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (anchorRef.current?.contains(t)) return
      if (t instanceof Element && t.closest('.pair-filter-menu')) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDoc, true)
    }, 0)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDoc, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [anchorRef, onClose])

  const count = (status: PairCompareStatus | 'differences'): number => {
    if (!result) return 0
    if (status === 'differences') {
      return result.rows.filter((r) => r.status !== 'identical').length
    }
    if (status === 'type_conflict') {
      return (
        (result.counts.type_conflict ?? 0) +
        (result.counts.inaccessible ?? 0) +
        (result.counts.error ?? 0)
      )
    }
    return result.counts[status] ?? 0
  }

  const toggle = (status: PairCompareStatus | 'differences'): void => {
    if (status === 'differences') {
      setVisibleStatuses(
        new Set<PairCompareStatus>([
          'left_only',
          'right_only',
          'left_newer',
          'right_newer',
          'different',
          'type_conflict',
          'inaccessible',
          'error'
        ])
      )
      return
    }
    if (status === 'type_conflict') {
      const next = new Set(visible)
      const group: PairCompareStatus[] = ['type_conflict', 'inaccessible', 'error']
      const allOn = group.every((s) => next.has(s))
      for (const s of group) {
        if (allOn) next.delete(s)
        else next.add(s)
      }
      setVisibleStatuses(next)
      return
    }
    const next = new Set(visible)
    if (next.has(status)) next.delete(status)
    else next.add(status)
    setVisibleStatuses(next)
  }

  if (!pos) return null

  return createPortal(
    <div
      className="pair-filter-menu"
      role="menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {OPTIONS.map((o) => {
        const checked =
          o.id === 'differences'
            ? !visible.has('identical')
            : o.id === 'type_conflict'
              ? visible.has('type_conflict')
              : visible.has(o.id)
        return (
          <button
            key={o.id}
            type="button"
            className="pair-filter-item"
            role="menuitemcheckbox"
            aria-checked={checked}
            onClick={() => toggle(o.id)}
          >
            <span className="pair-filter-check">{checked ? '✓' : ''}</span>
            <span className="pair-filter-label">{o.label}</span>
            <span className="pair-filter-count">{count(o.id)}</span>
          </button>
        )
      })}
      <div className="pair-rail-sep" style={{ margin: '4px 0', width: '100%' }} />
      <button
        type="button"
        className="pair-filter-item"
        onClick={() => {
          selectByStatus('differences')
          onClose()
        }}
      >
        Select all visible differences
      </button>
      <button
        type="button"
        className="pair-filter-item"
        onClick={() => {
          selectByStatus('left_only')
          onClose()
        }}
      >
        Select left-only
      </button>
      <button
        type="button"
        className="pair-filter-item"
        onClick={() => {
          selectByStatus('right_only')
          onClose()
        }}
      >
        Select right-only
      </button>
      <button
        type="button"
        className="pair-filter-item"
        onClick={() => {
          clearSelection()
          onClose()
        }}
      >
        Clear selection
      </button>
    </div>,
    document.body
  )
}
