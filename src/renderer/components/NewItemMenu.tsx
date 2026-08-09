import { createElement, useEffect, useRef, useState, type JSX } from 'react'
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
  const openDialog = useAppStore((s) => s.openDialog)
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const parent = listingPath || activePath
  const disabled = recycleBinActive || !parent
  /** Absolute probe paths for shell type icons (files need not exist). */
  const folderProbe = parent ? joinPath(parent, '__mfe_new_folder') : ''
  const fileProbe = (ext: string): string => (parent ? joinPath(parent, `__mfe_new${ext}`) : '')

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
      if (t instanceof Element && t.closest('.new-item-menu-panel')) return
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

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const menu =
    open && !disabled && menuPos && parent
      ? createPortal(
          <div
            className="context-menu new-item-menu-panel"
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
                  setOpen(false)
                  void createTypedFile(parent, t.stem, t.ext)
                }}
              >
                <ShellIcon path={fileProbe(t.ext)} size={16} isDir={false} />
                {t.label}
              </button>
            ))}
            <div className="menu-sep" />
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false)
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
          <PlusIcon size={14} />
        </span>
        <span className="new-item-label">New</span>
        <ChevronDown size={12} />
      </button>
      {menu}
    </div>
  )
}
