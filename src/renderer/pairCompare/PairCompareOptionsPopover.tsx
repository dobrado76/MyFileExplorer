import { useEffect, useLayoutEffect, useState, type JSX, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { PairCompareMethod } from '@shared/schemas/pairFolders'
import { usePairCompareStore } from './pairCompareStore'

type Props = {
  anchorRef: RefObject<HTMLElement | null>
}

export function PairCompareOptionsPopover({ anchorRef }: Props): JSX.Element | null {
  const options = usePairCompareStore((s) => s.options)
  const patchOptions = usePairCompareStore((s) => s.patchOptions)
  const setShowOptions = usePairCompareStore((s) => s.setShowOptions)
  const startCompare = usePairCompareStore((s) => s.startCompare)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const place = (): void => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const width = 300
      let left = r.right + 6
      if (left + width > window.innerWidth - 8) left = Math.max(8, r.left - width - 6)
      let top = r.top
      const maxH = Math.min(420, window.innerHeight - 16)
      if (top + maxH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - maxH - 8)
      setPos((prev) =>
        prev && prev.top === top && prev.left === left ? prev : { top, left }
      )
    }
    place()
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('resize', place)
    }
  }, [anchorRef])

  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (anchorRef.current?.contains(t)) return
      if (t instanceof Element && t.closest('.pair-compare-options')) return
      setShowOptions(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setShowOptions(false)
    }
    // Defer so the opening click does not immediately close.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDoc, true)
    }, 0)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDoc, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [anchorRef, setShowOptions])

  if (!pos) return null

  return createPortal(
    <div
      className="pair-compare-options"
      role="dialog"
      aria-label="Compare options"
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <label className="pair-opt-row pair-opt-check">
        <input
          type="checkbox"
          checked={options.includeSubfolders}
          onChange={(e) => patchOptions({ includeSubfolders: e.target.checked })}
        />
        Include subfolders
      </label>
      <label className="pair-opt-row pair-opt-check">
        <input
          type="checkbox"
          checked={options.followLinks}
          onChange={(e) => patchOptions({ followLinks: e.target.checked })}
        />
        Follow directory links / junctions
      </label>
      <label className="pair-opt-row pair-opt-check">
        <input
          type="checkbox"
          checked={options.ignoreEmptyFolders}
          onChange={(e) => patchOptions({ ignoreEmptyFolders: e.target.checked })}
        />
        Ignore empty folders
      </label>
      <label className="pair-opt-row">
        Comparison method
        <select
          value={options.compareMethod}
          onChange={(e) =>
            patchOptions({ compareMethod: e.target.value as PairCompareMethod })
          }
        >
          <option value="size_mtime">Fast: size + modified time</option>
          <option value="size">Size only</option>
          <option value="hash_when_needed">Content hash when needed</option>
          <option value="hash_all">Always content hash</option>
        </select>
      </label>
      <label className="pair-opt-row">
        Modified-time tolerance (ms)
        <input
          type="number"
          min={0}
          max={60000}
          value={options.modifiedToleranceMs}
          onChange={(e) =>
            patchOptions({ modifiedToleranceMs: Number(e.target.value) || 0 })
          }
        />
      </label>
      <div className="pair-opt-actions">
        <button type="button" className="btn" onClick={() => setShowOptions(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setShowOptions(false)
            void startCompare()
          }}
        >
          Compare
        </button>
      </div>
    </div>,
    document.body
  )
}
