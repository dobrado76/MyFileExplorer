import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../store/appStore'
import { ViewPresetsIcon } from '../lib/icons'

export function ViewPresetsMenu(): JSX.Element {
  const presets = useAppStore((s) => s.settings.viewPresets)
  const applyViewPreset = useAppStore((s) => s.applyViewPreset)
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
      let left = r.left
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
      if (left < 8) left = 8
      setMenuPos({ top: r.bottom + 4, left })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (btnRef.current?.contains(t)) return
      if (t instanceof Element && t.closest('.view-presets-menu-panel')) return
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

  const sorted = [...presets].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="icon-btn"
        aria-label="View presets"
        title="View presets — save or apply icon size, columns, and sort"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <ViewPresetsIcon />
      </button>
      {open && menuPos
        ? createPortal(
            <div
              className="context-menu view-presets-menu-panel"
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
                  openDialog({ kind: 'view-preset-name' })
                }}
              >
                Save current view as preset…
              </button>
              <button
                type="button"
                className="menu-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  openDialog({ kind: 'settings', section: 'folderviews' })
                }}
              >
                Manage presets…
              </button>
              {sorted.length > 0 ? <div className="menu-sep" /> : null}
              {sorted.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    void applyViewPreset(p.id)
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
