import { useCallback, useEffect, lazy, Suspense, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { TabBar } from '../components/TabBar'
import { Toolbar } from '../components/Toolbar'
import { FolderTree } from '../components/FolderTree'
import { FileView } from '../components/FileView'
import { SearchBanner } from '../components/SearchBanner'
import { RecycleBinBanner } from '../components/RecycleBinBanner'
import { PreviewPane } from '../components/PreviewPane'
import { StatusBar } from '../components/StatusBar'
import { ContextMenu } from '../components/ContextMenu'
import { Dialogs } from '../components/Dialogs'
import { ImageViewer } from '../components/ImageViewer'
import { Splitter } from '../components/Splitter'
import { basename } from '../lib/paths'
import { isImageExt } from '../lib/icons'

const ImageEditor = lazy(async () => {
  const m = await import('../components/ImageEditor')
  return { default: m.ImageEditor }
})

const TREE_MIN = 140
const PREVIEW_MIN = 200
/** Keep a usable center file pane; side panes otherwise have no fixed max. */
const FILES_MIN = 240

function maxTreeWidthPx(previewCollapsed: boolean, previewWidthPx: number): number {
  const other = previewCollapsed ? 0 : previewWidthPx
  return Math.max(TREE_MIN, window.innerWidth - other - FILES_MIN)
}

function maxPreviewWidthPx(treeCollapsed: boolean, treeWidthPx: number): number {
  const other = treeCollapsed ? 0 : treeWidthPx
  return Math.max(PREVIEW_MIN, window.innerWidth - other - FILES_MIN)
}

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/** True when the user highlighted text (e.g. preview) — let the browser handle Ctrl+C. */
function hasTextSelection(): boolean {
  const sel = window.getSelection()
  return !!sel && !sel.isCollapsed && (sel.toString().length ?? 0) > 0
}

function isTreeTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('.tree, .pane-tree')
}

/** File-view selection, or the focused tree folder when the tree has keyboard/mouse focus. */
function clipboardActionPaths(s: ReturnType<typeof useAppStore.getState>, target: EventTarget | null): string[] {
  if (isTreeTarget(target)) {
    const p = s.treeFocusPath ?? s.activeTab().path
    return p ? [p] : []
  }
  return s.activeTab().selected
}

export function ExplorerShell(): JSX.Element {
  const splitters = useAppStore((s) => s.splitters)
  const setSplitters = useAppStore((s) => s.setSplitters)
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const imageEditorOpen = useAppStore((s) => s.imageEditor !== null)

  // Window title follows the active tab.
  useEffect(() => {
    if (activeTab) {
      document.title = `${activeTab.title ?? basename(activeTab.path)} — MyFileExplorer`
    }
  }, [activeTab])

  const onKeyDown = useCallback((e: KeyboardEvent): void => {
    const s = useAppStore.getState()
    if (s.dialog || s.contextMenu) return
    const editing = isEditingTarget(e.target) || s.renamingPath !== null || s.addressEditing

    const key = e.key
    const ctrl = e.ctrlKey
    const shift = e.shiftKey
    const alt = e.altKey

    // shortcuts that also work while editing are none — bail early
    if (editing) return

    if (ctrl && !shift && key.toLowerCase() === 't') {
      e.preventDefault()
      void s.newTab()
    } else if (ctrl && !shift && key.toLowerCase() === 'w') {
      e.preventDefault()
      void s.closeTab(s.activeTabId)
    } else if (ctrl && key === 'Tab') {
      e.preventDefault()
      void s.nextTab()
    } else if (alt && key === 'ArrowLeft') {
      e.preventDefault()
      void s.goBack()
    } else if (alt && key === 'ArrowRight') {
      e.preventDefault()
      void s.goForward()
    } else if (key === 'Backspace') {
      e.preventDefault()
      if (s.recycleBin.active) {
        s.closeRecycleBinView()
        return
      }
      void s.goUp()
    } else if (key === 'F5') {
      e.preventDefault()
      void s.refresh()
    } else if (key === 'F2') {
      if (s.recycleBin.active) return
      e.preventDefault()
      const inTree =
        e.target instanceof Element && !!e.target.closest('.tree, .pane-tree')
      const sel = s.activeTab().selected
      if (inTree) {
        const treePath = s.treeFocusPath ?? s.activeTab().path
        if (treePath) s.startRename(treePath, 'tree')
      } else if (sel.length === 1 && sel[0]) {
        s.startRename(sel[0], 'files')
      } else if (s.treeFocusPath) {
        // No file-view selection — rename the tree-focused folder
        s.startRename(s.treeFocusPath, 'tree')
      }
    } else if (ctrl && !alt && key.toLowerCase() === 'c') {
      // Preview / selectable text: native copy. Otherwise copy selected files (or tree focus).
      if (hasTextSelection()) return
      e.preventDefault()
      s.copySelection(clipboardActionPaths(s, e.target))
    } else if (ctrl && !alt && key.toLowerCase() === 'x') {
      if (hasTextSelection()) return
      if (s.recycleBin.active) return
      e.preventDefault()
      s.cutSelection(clipboardActionPaths(s, e.target))
    } else if (ctrl && !alt && key.toLowerCase() === 'v') {
      if (s.recycleBin.active) return
      e.preventDefault()
      void s.paste()
    } else if (ctrl && key.toLowerCase() === 'a') {
      e.preventDefault()
      s.selectAll()
    } else if (ctrl && !shift && key.toLowerCase() === 'z') {
      e.preventDefault()
      void s.undo()
    } else if (ctrl && (key.toLowerCase() === 'y' || (shift && key.toLowerCase() === 'z'))) {
      e.preventDefault()
      void s.redo()
    } else if (key === 'Delete') {
      e.preventDefault()
      // Tree focus → delete that folder; file view → delete selection (same as F2 / Ctrl+C).
      const paths = isTreeTarget(e.target) ? clipboardActionPaths(s, e.target) : undefined
      void s.deleteSelection(shift, paths)
    } else if (ctrl && (key.toLowerCase() === 'f' || key.toLowerCase() === 'e')) {
      e.preventDefault()
      document.querySelector<HTMLInputElement>('[data-search-input]')?.focus()
    } else if (ctrl && shift && key.toLowerCase() === 'p') {
      e.preventDefault()
      const sp = useAppStore.getState().splitters
      useAppStore.getState().setSplitters({ previewCollapsed: !sp.previewCollapsed })
    } else if (ctrl && key.toLowerCase() === 'l') {
      e.preventDefault()
      s.setAddressEditing(true)
    } else if (key === 'Enter') {
      const sel = s.activeTab().selected
      if (sel.length >= 1) {
        e.preventDefault()
        if (s.recycleBin.active) {
          void s.restoreFromRecycleBinView(sel)
          return
        }
        const pool = s.search.active
          ? // search entries resolved in FileView; use listing fallback for open
            s.listing.entries
          : s.listing.entries
        const selectedEntries = sel
          .map((p) => pool.find((en) => en.path.toLowerCase() === p.toLowerCase()))
          .filter((en): en is NonNullable<typeof en> => !!en)
        const imagePaths = selectedEntries
          .filter((en) => en.kind === 'file' && isImageExt(en.ext))
          .map((en) => en.path)
        if (imagePaths.length > 0 && imagePaths.length === selectedEntries.length) {
          s.openImageViewer(imagePaths[0]!, imagePaths)
        } else {
          for (const entry of selectedEntries) void s.openEntry(entry)
        }
      }
    } else if (key === 'Escape') {
      if (s.imageViewer) s.closeImageViewer()
      else if (s.recycleBin.active) s.closeRecycleBinView()
      else if (s.search.active) s.clearSearch()
      else s.setSelection([], null, null)
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  return (
    <div className="shell">
      <TabBar />
      <Toolbar />
      <div className="shell-body">
        {!splitters.treeCollapsed && (
          <>
            <div
              className="pane-tree"
              data-drag-scroll
              style={{ width: splitters.treeWidthPx }}
            >
              <FolderTree />
            </div>
            <Splitter
              onDrag={(delta) => {
                // Read fresh widths from the store: this callback is captured once
                // at pointerdown, so render-time values would be stale.
                const sp = useAppStore.getState().splitters
                const max = maxTreeWidthPx(sp.previewCollapsed, sp.previewWidthPx)
                setSplitters({
                  treeWidthPx: Math.min(max, Math.max(TREE_MIN, sp.treeWidthPx + delta))
                })
              }}
            />
          </>
        )}
        <div className="pane-files">
          <RecycleBinBanner />
          <SearchBanner />
          <FileView />
        </div>
        {!splitters.previewCollapsed && (
          <>
            <Splitter
              onDrag={(delta) => {
                const sp = useAppStore.getState().splitters
                const max = maxPreviewWidthPx(sp.treeCollapsed, sp.treeWidthPx)
                setSplitters({
                  previewWidthPx: Math.min(max, Math.max(PREVIEW_MIN, sp.previewWidthPx - delta))
                })
              }}
            />
            <div className="pane-preview" style={{ width: splitters.previewWidthPx }}>
              <PreviewPane />
            </div>
          </>
        )}
      </div>
      <StatusBar />
      <ContextMenu />
      <Dialogs />
      <ImageViewer />
      {imageEditorOpen ? (
        <Suspense fallback={null}>
          <ImageEditor />
        </Suspense>
      ) : null}
    </div>
  )
}
