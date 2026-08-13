import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore, dropOperation } from '../store/appStore'
import { basename, samePath, parentOf } from '../lib/paths'
import { findDropDirAt, isValidDropDest } from '../lib/rightDrag'
import { ChevronLeft, ChevronRight, CloseIcon, PlusIcon, RecycleBinIcon } from '../lib/icons'
import { TabLucideIcon } from './TabLucideIcon'

type TabMenuState = { tabId: string; x: number; y: number }

const EDGE_SCROLL_PX = 28
const EDGE_SCROLL_STEP = 18

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
  const duplicateTab = useAppStore((s) => s.duplicateTab)
  const renameTab = useAppStore((s) => s.renameTab)
  const reorderTab = useAppStore((s) => s.reorderTab)
  const performTransfer = useAppStore((s) => s.performTransfer)
  const setDragPaths = useAppStore((s) => s.setDragPaths)
  const openRecycleBinView = useAppStore((s) => s.openRecycleBinView)
  const closeRecycleBinView = useAppStore((s) => s.closeRecycleBinView)
  const openDialog = useAppStore((s) => s.openDialog)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [dropTabId, setDropTabId] = useState<string | null>(null)
  const [menu, setMenu] = useState<TabMenuState | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const dragIndex = useRef<number | null>(null)
  const tabsStripRef = useRef<HTMLDivElement | null>(null)
  const edgeScrollRaf = useRef<number | null>(null)
  const fileDragActive = dragPaths.length > 0
  const fontSizePx = useAppStore((s) => s.settings.fontSizePx)

  const updateScrollState = useCallback((): void => {
    const el = tabsStripRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const overflow = max > 1
    setOverflowing(overflow)
    setCanScrollLeft(overflow && el.scrollLeft > 1)
    setCanScrollRight(overflow && el.scrollLeft < max - 1)
  }, [])

  /** Size every tab to the widest label when they fit; equal-shrink only when they don't. */
  const layoutTabStrip = useCallback((): void => {
    const el = tabsStripRef.current
    if (!el) return
    const tabEls = Array.from(el.querySelectorAll<HTMLElement>('[data-tab-id]'))
    const cs = getComputedStyle(el)
    const min = Number.parseFloat(cs.getPropertyValue('--tab-min')) || 90
    const max = Number.parseFloat(cs.getPropertyValue('--tab-max')) || 220
    const gap = Number.parseFloat(cs.columnGap || cs.gap) || 3

    el.classList.add('is-measuring')
    el.classList.remove('is-equal')
    el.style.removeProperty('--tab-fit')
    void el.offsetWidth

    let naturalMax = 0
    for (const tabEl of tabEls) {
      naturalMax = Math.max(naturalMax, tabEl.getBoundingClientRect().width)
    }
    el.classList.remove('is-measuring')

    const n = tabEls.length
    const fit = Math.min(max, Math.max(min, Math.ceil(naturalMax)))
    const needed = n === 0 ? 0 : n * fit + Math.max(0, n - 1) * gap
    if (n > 0 && needed > el.clientWidth + 0.5) {
      el.classList.add('is-equal')
    } else if (n > 0) {
      el.style.setProperty('--tab-fit', `${fit}px`)
    }
    updateScrollState()
  }, [updateScrollState])

  const scrollByPage = (dir: -1 | 1): void => {
    const el = tabsStripRef.current
    if (!el) return
    const delta = Math.max(80, Math.floor(el.clientWidth * 0.8)) * dir
    el.scrollBy({ left: delta, behavior: 'smooth' })
  }

  const scrollActiveIntoView = useCallback((): void => {
    const el = tabsStripRef.current
    if (!el || !activeTabId || recycleBinActive) return
    const tabEl = Array.from(el.querySelectorAll<HTMLElement>('[data-tab-id]')).find(
      (n) => n.dataset.tabId === activeTabId
    )
    tabEl?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    updateScrollState()
  }, [activeTabId, recycleBinActive, updateScrollState])

  useLayoutEffect(() => {
    layoutTabStrip()
  }, [tabs, fontSizePx, editingId, editText, layoutTabStrip])

  useEffect(() => {
    const el = tabsStripRef.current
    if (!el) return
    const ro = new ResizeObserver(() => layoutTabStrip())
    ro.observe(el)
    el.addEventListener('scroll', updateScrollState, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', updateScrollState)
    }
  }, [layoutTabStrip, updateScrollState])

  useEffect(() => {
    scrollActiveIntoView()
  }, [scrollActiveIntoView, tabs.length])

  useEffect(() => {
    return () => {
      if (edgeScrollRaf.current != null) cancelAnimationFrame(edgeScrollRaf.current)
    }
  }, [])

  const commitRename = (id: string): void => {
    const text = editText.trim()
    renameTab(id, text.length > 0 ? text : null)
    setEditingId(null)
  }

  const startRename = (id: string): void => {
    const tab = tabs.find((t) => t.id === id)
    if (!tab) return
    setEditingId(id)
    setEditText(tab.title ?? '')
  }

  const onRecycleClick = (): void => {
    if (recycleBinActive) closeRecycleBinView()
    else void openRecycleBinView()
  }

  useEffect(() => {
    if (!menu) return
    const onDoc = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menu])

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

  const maybeEdgeScrollDuringTabDrag = (clientX: number): void => {
    if (dragIndex.current == null) return
    const el = tabsStripRef.current
    if (!el || !overflowing) return
    const rect = el.getBoundingClientRect()
    let dir = 0
    if (clientX < rect.left + EDGE_SCROLL_PX) dir = -1
    else if (clientX > rect.right - EDGE_SCROLL_PX) dir = 1
    if (dir === 0) {
      if (edgeScrollRaf.current != null) {
        cancelAnimationFrame(edgeScrollRaf.current)
        edgeScrollRaf.current = null
      }
      return
    }
    if (edgeScrollRaf.current != null) return
    const step = (): void => {
      const strip = tabsStripRef.current
      if (!strip || dragIndex.current == null) {
        edgeScrollRaf.current = null
        return
      }
      strip.scrollLeft += dir * EDGE_SCROLL_STEP
      updateScrollState()
      edgeScrollRaf.current = requestAnimationFrame(step)
    }
    edgeScrollRaf.current = requestAnimationFrame(step)
  }

  const menuTab = menu ? tabs.find((t) => t.id === menu.tabId) : null
  const menuPos = menu
    ? {
        left: Math.min(menu.x, window.innerWidth - 200),
        top: Math.min(menu.y, window.innerHeight - 180)
      }
    : null

  return (
    <div className="tabbar" role="tablist" aria-label="Folder tabs">
      <button
        type="button"
        className={`tabbar-scroll-btn${overflowing ? '' : ' is-hidden'}`}
        aria-label="Scroll tabs left"
        title="Scroll tabs left"
        disabled={!canScrollLeft}
        onClick={() => scrollByPage(-1)}
      >
        <ChevronLeft size={14} />
      </button>
      <div
        ref={tabsStripRef}
        className="tabbar-tabs"
        onScroll={updateScrollState}
        onWheel={(e) => {
          const el = tabsStripRef.current
          if (!el) return
          if (el.scrollWidth <= el.clientWidth + 1) return
          if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return
          e.preventDefault()
          el.scrollLeft += e.deltaY
          updateScrollState()
        }}
        onDragOver={(e) => {
          if (dragIndex.current != null) maybeEdgeScrollDuringTabDrag(e.clientX)
        }}
      >
        {tabs.map((tab, index) => {
          const title = tab.title ?? basename(tab.path)
          const active = tab.id === activeTabId && !recycleBinActive
          const offline = active && listingOffline && samePath(tab.path, listingPath)
          const dropTarget = dropTabId === tab.id
          return (
            <div
              key={tab.id}
              role="tab"
              data-tab-id={tab.id}
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
                e.dataTransfer.effectAllowed = 'copyMove'
                e.dataTransfer.setData('text/x-mfe-tab', tab.id)
                e.dataTransfer.setData('text/plain', tab.id)
              }}
              onDragEnd={() => {
                dragIndex.current = null
                if (edgeScrollRaf.current != null) {
                  cancelAnimationFrame(edgeScrollRaf.current)
                  edgeScrollRaf.current = null
                }
              }}
              onDragOver={(e) => {
                if (fileDragActive && isValidDropDest(dragPaths, tab.path)) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'
                  setDropTabId(tab.id)
                  return
                }
                if (dragIndex.current !== null) {
                  e.preventDefault()
                  maybeEdgeScrollDuringTabDrag(e.clientX)
                }
              }}
              onDragLeave={() => {
                setDropTabId((id) => (id === tab.id ? null : id))
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (edgeScrollRaf.current != null) {
                  cancelAnimationFrame(edgeScrollRaf.current)
                  edgeScrollRaf.current = null
                }
                if (fileDragActive) {
                  dropOnTab(tab.path, e.ctrlKey, e.shiftKey)
                  dragIndex.current = null
                  return
                }
                // Dropping a tab onto another tab reorders (pane assign uses pane drop zones).
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
              onDoubleClick={() => startRename(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMenu({ tabId: tab.id, x: e.clientX, y: e.clientY })
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
                  {tab.icon ? <TabLucideIcon icon={tab.icon} size={14} /> : null}
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
      </div>
      <button
        type="button"
        className={`tabbar-scroll-btn${overflowing ? '' : ' is-hidden'}`}
        aria-label="Scroll tabs right"
        title="Scroll tabs right"
        disabled={!canScrollRight}
        onClick={() => scrollByPage(1)}
      >
        <ChevronRight size={14} />
      </button>
      <button
        className="tab-new"
        aria-label="New tab"
        title="New tab (Ctrl+T)"
        onClick={() => void newTab()}
      >
        <PlusIcon size={14} />
      </button>
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

      {menu && menuTab && menuPos
        ? createPortal(
            <div
              className="context-menu tab-context-menu"
              role="menu"
              style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="menu-item"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  void duplicateTab(menuTab.id)
                }}
              >
                Duplicate tab
              </button>
              <button
                type="button"
                className="menu-item"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  startRename(menuTab.id)
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="menu-item"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  openDialog({ kind: 'tab-icon', tabId: menuTab.id })
                }}
              >
                {menuTab.icon ? 'Change icon…' : 'Set icon…'}
              </button>
              <div className="menu-sep" />
              <button
                type="button"
                className="menu-item danger"
                role="menuitem"
                disabled={tabs.length <= 1}
                onClick={() => {
                  setMenu(null)
                  void closeTab(menuTab.id)
                }}
              >
                Close
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
