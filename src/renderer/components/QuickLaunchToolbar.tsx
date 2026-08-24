import { useEffect, useRef, useState, type DragEvent, type JSX, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  isQuickLaunchPath,
  MAX_QUICK_LAUNCH,
  mergeQuickLaunchPaths
} from '@shared/schemas/quickLaunch'
import type { QuickLaunchItem } from '@shared/schemas/quickLaunch'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { QuickLaunchIcon } from './QuickLaunchIcon'

function electronFilePath(file: File): string {
  if (!('path' in file)) return ''
  const p = (file as File & { path?: unknown }).path
  return typeof p === 'string' ? p : ''
}

function pathsFromDrop(e: DragEvent): string[] {
  const fromOs = [...e.dataTransfer.files].map(electronFilePath).filter(Boolean)
  if (fromOs.length > 0) return fromOs
  return useAppStore.getState().dragPaths
}

export function QuickLaunchToolbar(): JSX.Element | null {
  const items = useAppStore((s) => s.settings.quickLaunch ?? [])
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const openDialog = useAppStore((s) => s.openDialog)
  const notify = useAppStore((s) => s.notify)
  const setDragPaths = useAppStore((s) => s.setDragPaths)
  const [dropHover, setDropHover] = useState(false)
  const [menu, setMenu] = useState<{
    id: string
    top: number
    left: number
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (menuRef.current?.contains(t)) return
      setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', onDoc, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDoc, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menu])

  const launch = (id: string): void => {
    void call(api.quickLaunch.launch({ id })).catch((e) =>
      notify(e instanceof Error ? e.message : 'Could not launch', true)
    )
  }

  const addPaths = async (paths: string[]): Promise<void> => {
    const launchable = paths.filter(isQuickLaunchPath)
    if (launchable.length === 0) {
      notify('Add a program (.exe, shortcut, or script)', true)
      return
    }
    const cur = useAppStore.getState().settings.quickLaunch
    if (cur.length >= MAX_QUICK_LAUNCH) {
      notify(`Quick Launch is limited to ${MAX_QUICK_LAUNCH} items`, true)
      return
    }
    const { next, added } = mergeQuickLaunchPaths(cur, launchable)
    if (added === 0) {
      notify('Already on Quick Launch')
      return
    }
    await applySettingsPatch({ quickLaunch: next })
  }

  const onDragOver = (e: DragEvent): void => {
    const paths = pathsFromDrop(e)
    const knownOk = paths.some(isQuickLaunchPath)
    const fromOs =
      paths.length === 0 &&
      [...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/uri-list')
    const ok = knownOk || fromOs
    if (!ok && paths.length === 0 && !fromOs) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = ok ? 'copy' : 'none'
    setDropHover(ok)
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setDropHover(false)
    const files = pathsFromDrop(e)
    setDragPaths([])
    if (files.length > 0) void addPaths(files)
  }

  const openManage = (): void => {
    setMenu(null)
    openDialog({ kind: 'settings', section: 'quicklaunch' })
  }

  if (items.length === 0) return null

  return (
    <div
      className={`toolbar-edit toolbar-quick-launch${dropHover ? ' drop-hover' : ''}`}
      role="group"
      aria-label="Quick Launch"
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        const next = e.relatedTarget
        if (next instanceof Node && e.currentTarget.contains(next)) return
        setDropHover(false)
      }}
      onDrop={onDrop}
    >
      <span className="toolbar-sep" aria-hidden />
      {items.map((item) => (
        <QuickLaunchButton
          key={item.id}
          item={item}
          onLaunch={() => launch(item.id)}
          onMenu={(el) => {
            const r = el.getBoundingClientRect()
            setMenu({ id: item.id, top: r.bottom + 4, left: r.left })
          }}
        />
      ))}
      {menu
        ? createPortal(
            <QuickLaunchItemMenu
              menuRef={menuRef}
              item={items.find((x) => x.id === menu.id)}
              top={menu.top}
              left={menu.left}
              onLaunch={() => {
                const id = menu.id
                setMenu(null)
                launch(id)
              }}
              onReveal={() => {
                const id = menu.id
                setMenu(null)
                void call(api.quickLaunch.reveal({ id })).catch((e) =>
                  notify(e instanceof Error ? e.message : 'Could not open location', true)
                )
              }}
              onManage={openManage}
              onRemove={() => {
                const id = menu.id
                setMenu(null)
                const item = useAppStore.getState().settings.quickLaunch.find((x) => x.id === id)
                const next = useAppStore.getState().settings.quickLaunch.filter((x) => x.id !== id)
                void applySettingsPatch({ quickLaunch: next })
                if (item?.iconKind === 'custom' && item.iconId) {
                  void call(api.quickLaunch.deleteIcon({ id: item.iconId })).catch(() => {})
                }
              }}
            />,
            document.body
          )
        : null}
    </div>
  )
}

function QuickLaunchButton({
  item,
  onLaunch,
  onMenu
}: {
  item: QuickLaunchItem
  onLaunch: () => void
  onMenu: (el: HTMLButtonElement) => void
}): JSX.Element {
  const btnRef = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={btnRef}
      type="button"
      className="quick-launch-btn"
      aria-label={item.name}
      title={item.name}
      onClick={onLaunch}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (btnRef.current) onMenu(btnRef.current)
      }}
    >
      <QuickLaunchIcon item={item} size={26} />
    </button>
  )
}

function QuickLaunchItemMenu({
  menuRef,
  item,
  top,
  left,
  onLaunch,
  onReveal,
  onManage,
  onRemove
}: {
  menuRef: RefObject<HTMLDivElement | null>
  item: QuickLaunchItem | undefined
  top: number
  left: number
  onLaunch: () => void
  onReveal: () => void
  onManage: () => void
  onRemove: () => void
}): JSX.Element {
  return (
    <div
      ref={menuRef}
      className="context-menu quick-launch-menu-panel"
      role="menu"
      style={{ position: 'fixed', top, left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button type="button" className="menu-item" role="menuitem" onClick={onLaunch}>
        Open {item?.name ?? ''}
      </button>
      <button type="button" className="menu-item" role="menuitem" onClick={onReveal}>
        Open file location
      </button>
      <button type="button" className="menu-item" role="menuitem" onClick={onManage}>
        Manage Quick Launch…
      </button>
      <div className="menu-sep" />
      <button type="button" className="menu-item" role="menuitem" onClick={onRemove}>
        Remove from Quick Launch
      </button>
    </div>
  )
}
