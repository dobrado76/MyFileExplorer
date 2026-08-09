import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../store/appStore'
import { LayoutsIcon } from '../lib/icons'

/** Toolbar control: apply / save / manage named workspace layouts. */
export function LayoutsMenu(): JSX.Element {
  const layouts = useAppStore((s) => s.settings.layouts)
  const applyLayout = useAppStore((s) => s.applyLayout)
  const openDialog = useAppStore((s) => s.openDialog)
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) {
      setMenuPos(null)
      return
    }
    const place = (): void => {
      const btn = btnRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const width = 240
      let left = r.right - width
      if (left < 8) left = 8
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
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
      if (t instanceof Element && t.closest('.layouts-menu-panel')) return
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

  const sorted = [...layouts].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )

  const menu =
    open && menuPos
      ? createPortal(
          <div
            className="context-menu layouts-menu-panel"
            role="menu"
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                openDialog({ kind: 'layout-name', mode: 'save' })
              }}
            >
              Save current layout as…
            </button>
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                openDialog({ kind: 'settings', section: 'layouts' })
              }}
            >
              Manage layouts…
            </button>
            {sorted.length > 0 && <div className="menu-sep" />}
            {sorted.length === 0 ? (
              <div className="menu-hint">No saved layouts yet</div>
            ) : (
              sorted.map((layout) => (
                <button
                  key={layout.id}
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  title={layout.tabs.map((t) => t.path).join('\n')}
                  onClick={() => {
                    setOpen(false)
                    void applyLayout(layout.id)
                  }}
                >
                  {layout.name}
                  <span className="menu-hint">
                    {layout.tabs.length} tab{layout.tabs.length === 1 ? '' : 's'}
                  </span>
                </button>
              ))
            )}
          </div>,
          document.body
        )
      : null

  return (
    <div className="layouts-menu">
      <button
        ref={btnRef}
        type="button"
        className={`icon-btn${open ? ' active' : ''}`}
        aria-label="Layouts"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Layouts — save or switch workspace tabs"
        onClick={() => setOpen((v) => !v)}
      >
        <LayoutsIcon />
      </button>
      {menu}
    </div>
  )
}
