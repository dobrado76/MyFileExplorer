import { useRef, useState, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { basename, samePath } from '../lib/paths'
import { call, api, IpcError } from '../lib/ipc'
import { CloseIcon, PlusIcon, RecycleBinIcon } from '../lib/icons'

export function TabBar(): JSX.Element {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const listingOffline = useAppStore((s) => s.listing.offline)
  const listingPath = useAppStore((s) => s.listing.path)
  const activateTab = useAppStore((s) => s.activateTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const newTab = useAppStore((s) => s.newTab)
  const renameTab = useAppStore((s) => s.renameTab)
  const reorderTab = useAppStore((s) => s.reorderTab)
  const notify = useAppStore((s) => s.notify)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const dragIndex = useRef<number | null>(null)

  const commitRename = (id: string): void => {
    const text = editText.trim()
    renameTab(id, text.length > 0 ? text : null)
    setEditingId(null)
  }

  const openRecycleBin = (): void => {
    void (async () => {
      try {
        const res = await call(api.shell.openRecycleBin())
        if (!res.opened) notify(res.message ?? 'Could not open Recycle Bin', true)
      } catch (e) {
        notify(e instanceof IpcError ? e.message : String(e), true)
      }
    })()
  }

  return (
    <div className="tabbar" role="tablist" aria-label="Folder tabs">
      <div className="tabbar-tabs">
        {tabs.map((tab, index) => {
          const title = tab.title ?? basename(tab.path)
          const active = tab.id === activeTabId
          const offline = active && listingOffline && samePath(tab.path, listingPath)
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              className={`tab${active ? ' active' : ''}${offline ? ' offline' : ''}`}
              title={offline ? `${tab.path} (offline)` : tab.path}
              draggable={editingId !== tab.id}
              onDragStart={(e) => {
                dragIndex.current = index
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (dragIndex.current !== null) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
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
              onClick={() => void activateTab(tab.id)}
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
        className="tabbar-recycle"
        aria-label="Recycle Bin"
        title="Open Recycle Bin"
        onClick={openRecycleBin}
      >
        <RecycleBinIcon size={16} />
        <span className="tabbar-recycle-label">Recycle Bin</span>
      </button>
    </div>
  )
}
