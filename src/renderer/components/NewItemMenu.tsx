import { createElement, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { FilePlus2 } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { NEW_FILE_TYPES } from '../lib/newItemTypes'
import { joinPath } from '../lib/paths'
import { ChevronDown, PlusIcon } from '../lib/icons'
import { ShellIcon } from './ShellIcon'

/** Explorer-style “+ New” dropdown: folder, typed files, Other… */
export function NewItemMenu(): JSX.Element {
  const recycleBinActive = useAppStore((s) => s.recycleBin.active)
  const listingPath = useAppStore((s) => s.listing.path)
  const activePath = useAppStore((s) => s.activeTab().path)
  const createFolder = useAppStore((s) => s.createFolder)
  const createTypedFile = useAppStore((s) => s.createTypedFile)
  const createFromTemplate = useAppStore((s) => s.createFromTemplate)
  const templates = useAppStore((s) => s.settings.templates)
  const openDialog = useAppStore((s) => s.openDialog)
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [subOpen, setSubOpen] = useState(false)
  const [subPos, setSubPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const subTriggerRef = useRef<HTMLButtonElement>(null)
  const subPanelRef = useRef<HTMLDivElement>(null)
  const closeSubTimer = useRef<number | null>(null)

  const parent = listingPath || activePath
  const disabled = recycleBinActive || !parent
  /** Absolute probe paths for shell type icons (files need not exist). */
  const folderProbe = parent ? joinPath(parent, '__mfe_new_folder') : ''
  const fileProbe = (ext: string): string => (parent ? joinPath(parent, `__mfe_new${ext}`) : '')

  const cancelCloseSub = (): void => {
    if (closeSubTimer.current != null) {
      window.clearTimeout(closeSubTimer.current)
      closeSubTimer.current = null
    }
  }

  const scheduleCloseSub = (): void => {
    cancelCloseSub()
    closeSubTimer.current = window.setTimeout(() => setSubOpen(false), 180)
  }

  useEffect(() => {
    if (!open) {
      setMenuPos(null)
      setSubOpen(false)
      setSubPos(null)
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

  useLayoutEffect(() => {
    if (!open || !subOpen) {
      setSubPos(null)
      return
    }
    const trigger = subTriggerRef.current
    const panel = subPanelRef.current
    if (!trigger || !panel) return
    const r = trigger.getBoundingClientRect()
    const margin = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    const subW = panel.offsetWidth
    const subH = panel.offsetHeight
    const left =
      r.right + 4 + subW <= vw - margin ? r.right + 2 : Math.max(margin, r.left - subW - 2)
    let top = r.top
    if (top + subH > vh - margin) top = Math.max(margin, vh - margin - subH)
    setSubPos({ top, left })
  }, [open, subOpen, templates.length])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (btnRef.current?.contains(t)) return
      if (t instanceof Element && t.closest('.new-item-menu-panel')) return
      if (t instanceof Element && t.closest('.new-item-menu-sub')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (subOpen) setSubOpen(false)
        else setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDoc, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, subOpen])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => () => cancelCloseSub(), [])

  const closeMenu = (): void => {
    cancelCloseSub()
    setSubOpen(false)
    setOpen(false)
  }

  const templateFlyout =
    open && subOpen && parent
      ? createPortal(
          <div
            ref={subPanelRef}
            className="context-menu new-item-menu-sub"
            role="menu"
            style={{
              position: 'fixed',
              top: subPos?.top ?? 0,
              left: subPos?.left ?? 0,
              visibility: subPos ? 'visible' : 'hidden'
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseEnter={cancelCloseSub}
            onMouseLeave={scheduleCloseSub}
          >
            {templates.length === 0 ? (
              <button type="button" className="menu-item" role="menuitem" disabled>
                No templates yet
              </button>
            ) : (
              templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    closeMenu()
                    void createFromTemplate(t.id, parent)
                  }}
                >
                  {t.name}
                </button>
              ))
            )}
            <div className="menu-sep" />
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                closeMenu()
                openDialog({ kind: 'manage-templates' })
              }}
            >
              Manage Templates…
            </button>
          </div>,
          document.body
        )
      : null

  const menu =
    open && !disabled && menuPos && parent
      ? createPortal(
          <div
            className="context-menu new-item-menu-panel"
            role="menu"
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="new-item-menu-scroll">
              <button
                type="button"
                className="menu-item"
                role="menuitem"
                onClick={() => {
                  closeMenu()
                  void createFolder(parent)
                }}
              >
                <ShellIcon path={folderProbe} size={16} isDir />
                Folder
              </button>
              <div className="menu-sep" />
              {NEW_FILE_TYPES.map((t) => (
                <button
                  key={`${t.stem}${t.ext}`}
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    closeMenu()
                    void createTypedFile(parent, t.stem, t.ext)
                  }}
                >
                  <ShellIcon path={fileProbe(t.ext)} size={16} isDir={false} />
                  {t.label}
                </button>
              ))}
            </div>
            <div className="new-item-menu-foot">
              <button
                ref={subTriggerRef}
                type="button"
                className={`menu-item${subOpen ? ' focused' : ''}`}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={subOpen}
                onMouseEnter={() => {
                  cancelCloseSub()
                  setSubOpen(true)
                }}
                onMouseLeave={scheduleCloseSub}
                onClick={() => {
                  cancelCloseSub()
                  setSubOpen((v) => !v)
                }}
              >
                From Template
                <span className="menu-hint">▸</span>
              </button>
              <button
                type="button"
                className="menu-item"
                role="menuitem"
                onClick={() => {
                  closeMenu()
                  openDialog({ kind: 'new-file', parent })
                }}
              >
                {createElement(FilePlus2, {
                  size: 16,
                  strokeWidth: 2,
                  'aria-hidden': true,
                  className: 'new-item-menu-glyph'
                })}
                Other…
              </button>
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <div className="new-item-menu">
      <button
        ref={btnRef}
        type="button"
        className={`new-item-btn${open ? ' open' : ''}`}
        aria-label="New"
        aria-haspopup="menu"
        aria-expanded={open}
        title={
          disabled
            ? 'New item unavailable'
            : 'New folder or file in the current folder'
        }
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="new-item-plus" aria-hidden>
          <PlusIcon />
        </span>
        <span className="new-item-label">New</span>
        <ChevronDown size={12} />
      </button>
      {menu}
      {templateFlyout}
    </div>
  )
}
