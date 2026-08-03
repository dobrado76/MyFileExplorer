import { useEffect, useRef, useState, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { LayoutsIcon } from '../lib/icons'

/** Toolbar control: apply / save / manage named workspace layouts. */
export function LayoutsMenu(): JSX.Element {
  const layouts = useAppStore((s) => s.settings.layouts)
  const applyLayout = useAppStore((s) => s.applyLayout)
  const openDialog = useAppStore((s) => s.openDialog)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const sorted = [...layouts].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )

  return (
    <div className="layouts-menu" ref={rootRef}>
      <button
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
      {open && (
        <div className="context-menu layouts-menu-panel" role="menu">
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
        </div>
      )}
    </div>
  )
}
