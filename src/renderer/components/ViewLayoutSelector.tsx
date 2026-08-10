import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { ViewLayout } from '@shared/schemas/session'
import { useAppStore } from '../store/appStore'
import { ChevronDown } from '../lib/icons'

const MODES: { mode: ViewLayout; label: string; title: string }[] = [
  { mode: 1, label: '1', title: 'Single view' },
  { mode: 2, label: '2', title: 'Side-by-side (2 panes)' },
  { mode: 4, label: '4', title: '2×2 grid (4 panes)' }
]

function LayoutIcon({ mode }: { mode: ViewLayout }): JSX.Element {
  return <span className={`view-layout-icon layout-${mode}`} aria-hidden />
}

/** Toolbar dropdown: switch 1 / 2 / 4 file panes (D31). */
export function ViewLayoutSelector(): JSX.Element {
  const viewLayout = useAppStore((s) => s.viewLayout)
  const setViewLayout = useAppStore((s) => s.setViewLayout)
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const current = MODES.find((m) => m.mode === viewLayout) ?? MODES[0]!

  useEffect(() => {
    if (!open) {
      setMenuPos(null)
      return
    }
    const place = (): void => {
      const btn = btnRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const width = 200
      let left = r.left
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
      if (left < 8) left = 8
      setMenuPos({ top: r.bottom + 4, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (btnRef.current?.contains(t)) return
      if (t instanceof Element && t.closest('.view-layout-menu-panel')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDoc, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const menu =
    open && menuPos
      ? createPortal(
          <div
            className="context-menu view-layout-menu-panel"
            role="menu"
            aria-label="View layout"
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {MODES.map(({ mode, title }) => (
              <button
                key={mode}
                type="button"
                className={`menu-item view-layout-menu-item${viewLayout === mode ? ' is-active' : ''}`}
                role="menuitemradio"
                aria-checked={viewLayout === mode}
                onClick={() => {
                  setOpen(false)
                  void setViewLayout(mode)
                }}
              >
                <LayoutIcon mode={mode} />
                <span className="view-layout-menu-title">{title}</span>
                {viewLayout === mode ? <span className="menu-check">✓</span> : null}
              </button>
            ))}
          </div>,
          document.body
        )
      : null

  return (
    <div className="view-layout-selector">
      <button
        ref={btnRef}
        type="button"
        className={`view-layout-trigger${open ? ' open' : ''}`}
        aria-label={`View layout: ${current.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`View layout — ${current.title}`}
        onClick={() => setOpen((v) => !v)}
      >
        <LayoutIcon mode={current.mode} />
        <span className="view-layout-label">{current.label}</span>
        <ChevronDown size={12} />
      </button>
      {menu}
    </div>
  )
}
