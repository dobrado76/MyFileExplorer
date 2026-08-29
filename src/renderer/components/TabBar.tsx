import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore, dropOperation } from '../store/appStore'
import { basename, samePath, parentOf } from '../lib/paths'
import type { ClosedTabEntry } from '@shared/schemas/session'
import {
  findDropDirAt,
  getLiveRightDragSession,
  isValidDropDest,
  shouldSuppressContextMenu
} from '../lib/rightDrag'
import { isCustomTabIcon, isIconOnlyTab, isLucideTabIcon } from '@shared/tabIcons'
import { recycleBinShowsInToolbar } from '@shared/recycleBinTree'
import { isVirtualFolderDocumentPath, virtualFolderDisplayName } from '@shared/virtualFolder'
import { ChevronLeft, ChevronRight, CloseIcon, PlusIcon, RecycleBinIcon } from '../lib/icons'
import { TabLucideIcon } from './TabLucideIcon'

type TabBarMenu =
  | { kind: 'tab'; tabId: string; x: number; y: number }
  | { kind: 'bar'; x: number; y: number }
  | { kind: 'recycle'; x: number; y: number }

/** Auto tab label from path (custom `tab.title` overrides this). */
function defaultTabTitle(path: string): string {
  if (isVirtualFolderDocumentPath(path)) return virtualFolderDisplayName(path)
  return basename(path)
}

function closedTabLabel(entry: ClosedTabEntry): string {
  const title = entry.tab.title?.trim()
  return title && title.length > 0 ? title : defaultTabTitle(entry.tab.path)
}

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
  const reopenClosedTab = useAppStore((s) => s.reopenClosedTab)
  const clearClosedTabs = useAppStore((s) => s.clearClosedTabs)
  const closedTabs = useAppStore((s) => s.closedTabs)
  const newTab = useAppStore((s) => s.newTab)
  const duplicateTab = useAppStore((s) => s.duplicateTab)
  const renameTab = useAppStore((s) => s.renameTab)
  const reorderTab = useAppStore((s) => s.reorderTab)
  const performTransfer = useAppStore((s) => s.performTransfer)
  const setDragPaths = useAppStore((s) => s.setDragPaths)
  const openRecycleBinView = useAppStore((s) => s.openRecycleBinView)
  const closeRecycleBinView = useAppStore((s) => s.closeRecycleBinView)
  const emptyRecycleBinView = useAppStore((s) => s.emptyRecycleBinView)
  const recycleBinKnownEmpty = useAppStore(
    (s) => s.recycleBin.active && !s.recycleBin.loading && s.recycleBin.items.length === 0
  )
  const openDialog = useAppStore((s) => s.openDialog)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [dropTabId, setDropTabId] = useState<string | null>(null)
  const [menu, setMenu] = useState<TabBarMenu | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const dragIndex = useRef<number | null>(null)
  const tabsStripRef = useRef<HTMLDivElement | null>(null)
  const edgeScrollRaf = useRef<number | null>(null)
  const fileDragActive = dragPaths.length > 0
  const fontSizePx = useAppStore((s) => s.settings.fontSizePx)
  const tabEqualWidth = useAppStore((s) => s.settings.tabEqualWidth)
  const showTabIcons = useAppStore((s) => s.settings.showTabIcons)
  const recycleBinPlacement = useAppStore((s) => s.settings.recycleBinPlacement)

  const updateScrollState = useCallback((): void => {
    const el = tabsStripRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const overflow = max > 1
    setOverflowing(overflow)
    setCanScrollLeft(overflow && el.scrollLeft > 1)
    setCanScrollRight(overflow && el.scrollLeft < max - 1)
  }, [])

  /** Equal-width: size every tab to the widest label, then equal-shrink if the strip overflows.
   *  Fit: each tab is only as wide as its own label + icon. */
  const layoutTabStrip = useCallback((): void => {
    const el = tabsStripRef.current
    if (!el) return
    el.classList.remove('is-equal', 'is-measuring', 'is-fit')
    el.style.removeProperty('--tab-fit')

    if (!tabEqualWidth) {
      el.classList.add('is-fit')
      updateScrollState()
      return
    }

    const tabEls = Array.from(el.querySelectorAll<HTMLElement>('[data-tab-id]'))
    const labeled = tabEls.filter((t) => !t.classList.contains('tab-icon-only'))
    const iconOnly = tabEls.filter((t) => t.classList.contains('tab-icon-only'))
    const cs = getComputedStyle(el)
    const min = Number.parseFloat(cs.getPropertyValue('--tab-min')) || 90
    const max = Number.parseFloat(cs.getPropertyValue('--tab-max')) || 220
    const gap = Number.parseFloat(cs.columnGap || cs.gap) || 3

    el.classList.add('is-measuring')
    void el.offsetWidth

    let naturalMax = 0
    for (const tabEl of labeled) {
      naturalMax = Math.max(naturalMax, tabEl.getBoundingClientRect().width)
    }
    let iconOnlyWidth = 0
    for (const tabEl of iconOnly) {
      iconOnlyWidth += tabEl.getBoundingClientRect().width
    }
    const newBtn = el.querySelector<HTMLElement>('.tab-new')
    const newBtnWidth = newBtn ? newBtn.getBoundingClientRect().width : 0
    el.classList.remove('is-measuring')

    const n = labeled.length
    const total = tabEls.length
    const fit = n === 0 ? 0 : Math.min(max, Math.max(min, Math.ceil(naturalMax)))
    const tabGaps = Math.max(0, total - 1) * gap
    const newBtnExtra = newBtnWidth > 0 ? gap + newBtnWidth : 0
    const needed = n * fit + iconOnlyWidth + tabGaps + newBtnExtra
    if (n > 0 && needed > el.clientWidth + 0.5) {
      el.classList.add('is-equal')
    } else if (n > 0) {
      el.style.setProperty('--tab-fit', `${fit}px`)
    }
    updateScrollState()
  }, [tabEqualWidth, updateScrollState])

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
  }, [tabs, fontSizePx, tabEqualWidth, showTabIcons, editingId, editText, layoutTabStrip])

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
    setEditText(tab.title ?? defaultTabTitle(tab.path))
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
    void performTransfer(
      dropOperation(src, destPath, ctrlKey, shiftKey),
      dragPaths,
      destPath,
      false,
      ctrlKey
    )
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

  const menuTab = menu?.kind === 'tab' ? tabs.find((t) => t.id === menu.tabId) : null
  const menuPos = menu
    ? {
        left: Math.min(menu.x, window.innerWidth - 200),
        top: Math.min(menu.y, window.innerHeight - 260)
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
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          if (fileDragActive || shouldSuppressContextMenu() || getLiveRightDragSession()) return
          setMenu({ kind: 'bar', x: e.clientX, y: e.clientY })
        }}
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
          const title = tab.title ?? defaultTabTitle(tab.path)
          const active = tab.id === activeTabId && !recycleBinActive
          const offline = active && listingOffline && samePath(tab.path, listingPath)
          const dropTarget = dropTabId === tab.id
          const iconOnly = isIconOnlyTab(tab.icon)
          const showCustom = isCustomTabIcon(tab.icon)
          const showLucide = showTabIcons && isLucideTabIcon(tab.icon)
          const showGlyph = showCustom || showLucide
          const renaming = editingId === tab.id
          const showTitle = renaming || !iconOnly
          return (
            <div
              key={tab.id}
              role="tab"
              data-tab-id={tab.id}
              aria-selected={active}
              aria-label={title}
              className={`tab${active ? ' active' : ''}${offline ? ' offline' : ''}${dropTarget ? ' drop-target' : ''}${iconOnly && !renaming ? ' tab-icon-only' : ''}`}
              title={
                offline
                  ? `${tab.path} (offline)`
                  : fileDragActive
                    ? `Drop to move/copy into ${tab.path}`
                    : iconOnly
                      ? `${title} — ${tab.path}`
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
                // Right-drag of files onto a tab owns this mouseup — Copy/Move menu,
                // not Duplicate/Rename/Close.
                if (
                  fileDragActive ||
                  shouldSuppressContextMenu() ||
                  getLiveRightDragSession()
                ) {
                  return
                }
                setMenu({ kind: 'tab', tabId: tab.id, x: e.clientX, y: e.clientY })
              }}
            >
              {renaming ? (
                <input
                  className="tab-rename-input"
                  autoFocus
                  value={editText}
                  placeholder={defaultTabTitle(tab.path)}
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
                  {showGlyph ? <TabLucideIcon icon={tab.icon} size={14} /> : null}
                  {showTitle ? <span className="tab-title">{title}</span> : null}
                  {offline && !iconOnly ? <span className="tab-offline-badge">Offline</span> : null}
                  {offline && iconOnly ? (
                    <span className="tab-offline-dot" title="Offline" aria-hidden />
                  ) : null}
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
          type="button"
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
        className={`tabbar-scroll-btn${overflowing ? '' : ' is-hidden'}`}
        aria-label="Scroll tabs right"
        title="Scroll tabs right"
        disabled={!canScrollRight}
        onClick={() => scrollByPage(1)}
      >
        <ChevronRight size={14} />
      </button>
      {recycleBinShowsInToolbar(recycleBinPlacement) && (
        <button
          type="button"
          className={`tabbar-recycle${recycleBinActive ? ' active' : ''}`}
          aria-label="Recycle Bin"
          aria-pressed={recycleBinActive}
          aria-haspopup="menu"
          title={recycleBinActive ? 'Close Recycle Bin' : 'Open Recycle Bin'}
          onClick={onRecycleClick}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setMenu({ kind: 'recycle', x: e.clientX, y: e.clientY })
          }}
        >
          <RecycleBinIcon size={16} />
        </button>
      )}

      {menu?.kind === 'recycle' && menuPos
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
                  onRecycleClick()
                }}
              >
                {recycleBinActive ? 'Close' : 'Open'}
              </button>
              <button
                type="button"
                className="menu-item danger"
                role="menuitem"
                disabled={recycleBinKnownEmpty}
                onClick={() => {
                  setMenu(null)
                  emptyRecycleBinView()
                }}
              >
                Empty Recycle Bin
              </button>
            </div>,
            document.body
          )
        : null}

      {menu?.kind === 'tab' && menuTab && menuPos
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
                  openDialog({
                    kind: isCustomTabIcon(menuTab.icon) ? 'tab-custom-icon' : 'tab-icon',
                    tabId: menuTab.id
                  })
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
              <div className="menu-sep" />
              <TabReopenMenuItems
                closedTabs={closedTabs}
                onReopen={(i) => {
                  setMenu(null)
                  void reopenClosedTab(i)
                }}
                onClear={() => {
                  setMenu(null)
                  clearClosedTabs()
                }}
              />
            </div>,
            document.body
          )
        : null}

      {menu?.kind === 'bar' && menuPos
        ? createPortal(
            <div
              className="context-menu tab-context-menu"
              role="menu"
              style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <TabReopenMenuItems
                closedTabs={closedTabs}
                onReopen={(i) => {
                  setMenu(null)
                  void reopenClosedTab(i)
                }}
                onClear={() => {
                  setMenu(null)
                  clearClosedTabs()
                }}
              />
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

function TabReopenMenuItems(props: {
  closedTabs: ClosedTabEntry[]
  onReopen: (index: number) => void
  onClear: () => void
}): JSX.Element {
  const empty = props.closedTabs.length === 0
  return (
    <>
      <button
        type="button"
        className="menu-item"
        role="menuitem"
        disabled={empty}
        onClick={() => {
          if (empty) return
          props.onReopen(0)
        }}
      >
        Reopen closed tab
        <span className="menu-hint">Ctrl+Shift+T</span>
      </button>
      {!empty ? (
        <div className="menu-sub-wrap">
          <button type="button" className="menu-item" role="menuitem" aria-haspopup="menu">
            Recently closed
            <span className="menu-hint">▸</span>
          </button>
          <div className="context-menu context-submenu" role="menu">
            {props.closedTabs.map((entry, i) => (
              <button
                key={`${entry.tab.id}-${i}`}
                type="button"
                className="menu-item"
                role="menuitem"
                title={entry.tab.path}
                onClick={() => props.onReopen(i)}
              >
                {closedTabLabel(entry)}
              </button>
            ))}
            <div className="menu-sep" />
            <button type="button" className="menu-item" role="menuitem" onClick={props.onClear}>
              Clear recently closed
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
