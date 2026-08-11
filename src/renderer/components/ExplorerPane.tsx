import { useCallback, type JSX } from 'react'
import { resolveFolderView } from '@shared/folderViews'
import type { ViewMode } from '@shared/schemas/session'
import { dropOperation, useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { Breadcrumb } from './Breadcrumb'
import { FolderTree } from './FolderTree'
import { FileView } from './FileView'
import { Splitter } from './Splitter'
import { ArrowLeft, ArrowRight, ArrowUp, RefreshIcon } from '../lib/icons'
import { parentOf, samePath } from '../lib/paths'

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: 'extraLargeIconsNoName', label: 'XL icons only' },
  { mode: 'extraLargeIcons', label: 'Extra large' },
  { mode: 'largeIcons', label: 'Large' },
  { mode: 'mediumIcons', label: 'Medium' },
  { mode: 'smallIcons', label: 'Small' },
  { mode: 'list', label: 'List' },
  { mode: 'details', label: 'Details' }
]

const TREE_MIN = 100
const FILES_MIN = 160

type Props = {
  paneIndex: number
}

export function ExplorerPane({ paneIndex }: Props): JSX.Element {
  const tabId = useAppStore((s) => s.paneTabIds[paneIndex] ?? null)
  const focused = useAppStore((s) => s.focusedPaneIndex === paneIndex)
  const viewLayout = useAppStore((s) => s.viewLayout)
  /** Focus ring only when comparing panes (2 / 4); useless in single view. */
  const showFocusRing = focused && viewLayout > 1
  const focusPane = useAppStore((s) => s.focusPane)
  const assignTabToPane = useAppStore((s) => s.assignTabToPane)
  const newTab = useAppStore((s) => s.newTab)
  const tab = useAppStore((s) => (tabId ? s.tabs.find((t) => t.id === tabId) : undefined))
  const splitters = useAppStore((s) => s.splitters)
  const setSplitters = useAppStore((s) => s.setSplitters)
  const folderViews = useAppStore((s) => s.settings.folderViews)
  const goBack = useAppStore((s) => s.goBack)
  const goForward = useAppStore((s) => s.goForward)
  const goUp = useAppStore((s) => s.goUp)
  const refresh = useAppStore((s) => s.refresh)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const dragPaths = useAppStore((s) => s.dragPaths)
  const setDragPaths = useAppStore((s) => s.setDragPaths)
  const setDropHighlight = useAppStore((s) => s.setDropHighlight)
  const dropHighlightPath = useAppStore((s) => s.dropHighlightPath)
  const performTransfer = useAppStore((s) => s.performTransfer)

  // Full-pane outline only matters when choosing among 2+ panes (D31).
  const paneDropActive = !!(
    viewLayout > 1 &&
    tab &&
    dropHighlightPath &&
    samePath(dropHighlightPath, tab.path)
  )

  const onTabDragOver = useCallback((e: React.DragEvent): void => {
    if (e.dataTransfer.types.includes('text/x-mfe-tab')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }, [])

  const onTabDrop = useCallback(
    (e: React.DragEvent): void => {
      const id = e.dataTransfer.getData('text/x-mfe-tab')
      if (!id) return
      e.preventDefault()
      e.stopPropagation()
      void assignTabToPane(paneIndex, id)
    },
    [assignTabToPane, paneIndex]
  )

  /** Put a new tab in this empty pane (newTab assigns to focused pane). */
  const openInThisPane = useCallback(
    async (path?: string): Promise<void> => {
      focusPane(paneIndex)
      await newTab(path)
    },
    [focusPane, newTab, paneIndex]
  )

  const openComputer = useCallback((): void => {
    const s = useAppStore.getState()
    const target = s.settings.defaultNewTabPath || s.homePath
    void openInThisPane(target || undefined)
  }, [openInThisPane])

  const browseFolder = useCallback((): void => {
    void (async () => {
      try {
        const res = await call(api.app.pickFolder())
        if (!res.path) return
        await openInThisPane(res.path)
      } catch {
        /* picker cancelled / failed */
      }
    })()
  }, [openInThisPane])

  if (!tabId || !tab) {
    return (
      <div
        className={`explorer-pane empty${showFocusRing ? ' focused' : ''}`}
        onMouseDown={() => focusPane(paneIndex)}
        onDragOver={onTabDragOver}
        onDrop={onTabDrop}
      >
        <div className="pane-empty-panel">
          <div className="pane-drop-hint">Drop a tab here</div>
          <div className="pane-empty-actions">
            <button type="button" className="btn primary" onClick={openComputer}>
              Open Computer
            </button>
            <button type="button" className="btn" onClick={browseFolder}>
              Browse…
            </button>
          </div>
          <p className="pane-empty-note">Or drag a tab from the tab bar</p>
        </div>
      </div>
    )
  }

  const owning = resolveFolderView(tab.path, folderViews)
  const viewMode = owning?.viewMode ?? tab.viewMode
  const treeCollapsed = splitters.treeCollapsed
  const treeWidth = splitters.treeWidthPx

  return (
    <div
      className={`explorer-pane${showFocusRing ? ' focused' : ''}${paneDropActive ? ' pane-drop-active' : ''}`}
      data-drop-dir={tab.path}
      onMouseDown={() => focusPane(paneIndex)}
      onDragOver={(e) => {
        onTabDragOver(e)
        // File drag onto this pane (any chrome) → that folder.
        if (dragPaths.length > 0) {
          e.preventDefault()
          setDropHighlight(tab.path)
        }
      }}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes('text/x-mfe-tab')) {
          onTabDrop(e)
          return
        }
        const src = dragPaths[0]
        if (dragPaths.length > 0 && src) {
          e.preventDefault()
          e.stopPropagation()
          setDropHighlight(null)
          void performTransfer(
            dropOperation(src, tab.path, e.ctrlKey, e.shiftKey),
            dragPaths,
            tab.path
          )
          setDragPaths([])
        }
      }}
    >
      <div className="pane-toolbar">
        <button
          className="icon-btn"
          aria-label="Back"
          title="Back"
          disabled={tab.back.length === 0}
          onClick={(e) => {
            e.stopPropagation()
            focusPane(paneIndex)
            void goBack()
          }}
        >
          <ArrowLeft />
        </button>
        <button
          className="icon-btn"
          aria-label="Forward"
          title="Forward"
          disabled={tab.forward.length === 0}
          onClick={(e) => {
            e.stopPropagation()
            focusPane(paneIndex)
            void goForward()
          }}
        >
          <ArrowRight />
        </button>
        <button
          className="icon-btn"
          aria-label="Up"
          title="Up"
          disabled={parentOf(tab.path) === null}
          onClick={(e) => {
            e.stopPropagation()
            focusPane(paneIndex)
            void goUp()
          }}
        >
          <ArrowUp />
        </button>
        <button
          className="icon-btn"
          aria-label="Refresh"
          title="Refresh"
          onClick={(e) => {
            e.stopPropagation()
            focusPane(paneIndex)
            void refresh()
          }}
        >
          <RefreshIcon />
        </button>
        <Breadcrumb tabId={tabId} />
        <select
          aria-label="View mode"
          value={viewMode}
          title="View mode"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            focusPane(paneIndex)
            setViewMode(e.target.value as ViewMode, tabId)
          }}
        >
          {VIEW_MODES.map((v) => (
            <option key={v.mode} value={v.mode}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      <div className="pane-body">
        {!treeCollapsed && (
          <>
            <div className="pane-tree" data-drag-scroll style={{ width: treeWidth }}>
              <FolderTree tabId={tabId} />
            </div>
            <Splitter
              onDrag={(delta) => {
                const sp = useAppStore.getState().splitters
                const max = Math.max(TREE_MIN, window.innerWidth - FILES_MIN - 80)
                setSplitters({
                  treeWidthPx: Math.min(max, Math.max(TREE_MIN, sp.treeWidthPx + delta))
                })
              }}
            />
          </>
        )}
        <div className="pane-files">
          <FileView tabId={tabId} />
        </div>
      </div>
    </div>
  )
}
