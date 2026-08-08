import { useEffect, useRef, useState, type JSX } from 'react'
import { useAppStore, dropOperation } from '../store/appStore'
import { basename, samePath, parentOf } from '../lib/paths'
import { findDropDirAt, isValidDropDest } from '../lib/rightDrag'
import { CloseIcon, PlusIcon, RecycleBinIcon } from '../lib/icons'

export function TabBar(): JSX.Element {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const listingOffline = useAppStore((s) => s.listing.offline)
  const listingPath = useAppStore((s) => s.listing.path)
  const recycleBinActive = useAppStore((s) => s.recycleBin.active)
  const dragPaths = useAppStore((s) => s.dragPaths)
  const activateTab = useAppStore((s) => s.activateTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const newTab = useAppStore((s) => s.newTab)
  const renameTab = useAppStore((s) => s.renameTab)
  const reorderTab = useAppStore((s) => s.reorderTab)
  const performTransfer = useAppStore((s) => s.performTransfer)
  const setDragPaths = useAppStore((s) => s.setDragPaths)
  const openRecycleBinView = useAppStore((s) => s.openRecycleBinView)
  const closeRecycleBinView = useAppStore((s) => s.closeRecycleBinView)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [dropTabId, setDropTabId] = useState<string | null>(null)
  const dragIndex = useRef<number | null>(null)
  const fileDragActive = dragPaths.length > 0

  const commitRename = (id: string): void => {
    const text = editText.trim()
    renameTab(id, text.length > 0 ? text : null)
    setEditingId(null)
  }

  const onRecycleClick = (): void => {
    if (recycleBinActive) closeRecycleBinView()
    else void openRecycleBinView()
  }

  // Highlight the tab under a left/right file drag (tabs are data-drop-dir targets).
  useEffect(() => {
    if (!fileDragActive) {
      setDropTabId(null)
      return
    }
    const onMove = (ev: PointerEvent | MouseEvent): void => {
      const dest = findDropDirAt(ev.clientX, ev.clientY)
      if (!dest || !isValidDropDest(dragPaths, dest)) {
        setDropTabId(null)
        return
      }
      const tab = tabs.find((t) => samePath(t.path, dest))
      setDropTabId(tab?.id ?? null)
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('mousemove', onMove, true)
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('mousemove', onMove, true)
    }
  }, [fileDragActive, dragPaths, tabs])

  const dropOnTab = (destPath: string, ctrlKey: boolean, shiftKey: boolean): void => {
    const src = dragPaths[0]
    if (!src || dragPaths.length === 0) return
    if (!isValidDropDest(dragPaths, destPath)) return
    // Same-folder move is a no-op (sorting into the tab you're already in).
    if (
      dragPaths.every((p) => samePath(parentOf(p) ?? '', destPath)) &&
      !ctrlKey
    ) {
      setDragPaths([])
      setDropTabId(null)
      return
    }
    void performTransfer(dropOperation(src, destPath, ctrlKey, shiftKey), dragPaths, destPath)
    setDragPaths([])
    setDropTabId(null)
  }

  return (
    <div className="tabbar" role="tablist" aria-label="Folder tabs">
      <div className="tabbar-tabs">
        {tabs.map((tab, index) => {
          const title = tab.title ?? basename(tab.path)
          const active = tab.id === activeTabId && !recycleBinActive
          const offline = active && listingOffline && samePath(tab.path, listingPath)
          const dropTarget = dropTabId === tab.id
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              className={`tab${active ? ' active' : ''}${offline ? ' offline' : ''}${dropTarget ? ' drop-target' : ''}`}
              title={
                offline
                  ? `${tab.path} (offline)`
                  : fileDragActive
                    ? `Drop to move/copy into ${tab.path}`
                    : tab.path
              }
              data-drop-dir={tab.path}
              draggable={editingId !== tab.id && !fileDragActive}
              onDragStart={(e) => {
                if (fileDragActive) {
                  e.preventDefault()
                  return
                }
                dragIndex.current = index
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (fileDragActive && isValidDropDest(dragPaths, tab.path)) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'
                  setDropTabId(tab.id)
                  return
                }
                if (dragIndex.current !== null) e.preventDefault()
              }}
              onDragLeave={() => {
                setDropTabId((id) => (id === tab.id ? null : id))
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (fileDragActive) {
                  dropOnTab(tab.path, e.ctrlKey, e.shiftKey)
                  dragIndex.current = null
                  return
                }
                if (dragIndex.current !== null && dragIndex.current !== index) {
                  reorderTab(dragIndex.current, index)
                }
                dragIndex.current = null
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  void closeTab(tab.id)
                }
              }}
              onClick={() => {
                if (recycleBinActive) closeRecycleBinView()
                void activateTab(tab.id)
              }}
              onDoubleClick={() => {
                setEditingId(tab.id)
                setEditText(tab.title ?? '')
              }}
            >
              {editingId === tab.id ? (
                <input
                  className="tab-rename-input"
                  autoFocus
                  value={editText}
                  placeholder={basename(tab.path)}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={() => commitRename(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(tab.id)
                    if (e.key === 'Escape') setEditingId(null)
                    e.stopPropagation()
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="tab-title">{title}</span>
                  {offline ? <span className="tab-offline-badge">Offline</span> : null}
                </>
              )}
              <button
                className="tab-close"
                aria-label={`Close ${title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void closeTab(tab.id)
                }}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          )
        })}
        <button
          className="tab-new"
          aria-label="New tab"
          title="New tab (Ctrl+T)"
          onClick={() => void newTab()}
        >
          <PlusIcon size={14} />
        </button>
      </div>
      <button
        type="button"
        className={`tabbar-recycle${recycleBinActive ? ' active' : ''}`}
        aria-label="Recycle Bin"
        aria-pressed={recycleBinActive}
        title={recycleBinActive ? 'Close Recycle Bin' : 'Open Recycle Bin'}
        onClick={onRecycleClick}
      >
        <RecycleBinIcon size={16} />
        <span className="tabbar-recycle-label">Recycle Bin</span>
      </button>
    </div>
  )
}
