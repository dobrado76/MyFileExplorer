import { useCallback, useEffect, useState, lazy, Suspense, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { TabBar } from '../components/TabBar'
import { Toolbar } from '../components/Toolbar'
import { ViewGrid } from '../components/ViewGrid'
import { PreviewPane } from '../components/PreviewPane'
import { StatusBar } from '../components/StatusBar'
import { ContextMenu } from '../components/ContextMenu'
import { GitFileHistoryHost } from '../components/git/GitFileHistoryDialog'
import { Dialogs } from '../components/Dialogs'
import { ImageViewer } from '../components/ImageViewer'
import { SlideshowOverlay } from '../components/SlideshowOverlay'
import { Splitter } from '../components/Splitter'
import { basename, samePath } from '../lib/paths'
import { isImageExt } from '../lib/icons'
import { searchResultsToEntries } from '../lib/searchEntries'
import { slideshowCurrentPath } from '../lib/slideshowTypes'
import { isEditableImagePath } from '@shared/imageEdit'
import { isVirtualFolderDocumentPath, virtualFolderDisplayName } from '@shared/virtualFolder'
import { api, call } from '../lib/ipc'
import { usePreviewTarget } from '../lib/usePreviewTarget'
import { clipboardActionPaths, isFolderTreeEventTarget } from '../lib/clipboardActionPaths'
import {
  FONT_SIZE_PX_MAX,
  FONT_SIZE_PX_MIN,
  ICON_SIZE_PX_MAX,
  ICON_SIZE_PX_MIN
} from '@shared/schemas/settings'

const ImageEditor = lazy(async () => {
  const m = await import('../components/ImageEditor')
  return { default: m.ImageEditor }
})

const PREVIEW_MIN = 200
/** Keep a usable center grid; preview otherwise has no fixed max. */
const GRID_MIN = 280

function maxPreviewWidthPx(): number {
  return Math.max(PREVIEW_MIN, window.innerWidth - GRID_MIN)
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

function pathsForClipboardShortcut(
  s: ReturnType<typeof useAppStore.getState>,
  target: EventTarget | null
): string[] {
  return clipboardActionPaths({
    selected: s.activeTab().selected,
    treeFocusPath: s.treeFocusPath,
    currentFolder: s.activeTab().path,
    eventTarget: target
  })
}

export function ExplorerShell(): JSX.Element {
  const splitters = useAppStore((s) => s.splitters)
  const setSplitters = useAppStore((s) => s.setSplitters)
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const imageEditorOpen = useAppStore((s) => s.imageEditor !== null)
  const slideshowActive = useAppStore((s) => s.slideshow.active != null)
  const slideshowIndex = useAppStore((s) => s.slideshow.active?.index ?? -1)
  const slideshowPath = useAppStore((s) =>
    s.slideshow.active ? slideshowCurrentPath(s.slideshow.active) : null
  )
  const titleFilename = useAppStore((s) => s.settings.slideshow.titleFilename === true)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const previewTarget = usePreviewTarget()

  // Keep the detached preview window in sync even when the docked pane is collapsed.
  // Skip while slideshow owns the screen — avoids listing scans + IPC on every shell paint.
  useEffect(() => {
    if (slideshowActive) return
    void api.preview.setTarget({
      path: previewTarget.previewPath,
      ads: previewTarget.versionOverrideAds,
      stamp: previewTarget.selectedStamp
    })
  }, [
    slideshowActive,
    previewTarget.previewPath,
    previewTarget.versionOverrideAds,
    previewTarget.selectedStamp
  ])

  const imageVersionPreview = useAppStore((s) => s.imageVersionPreview)
  const setImageVersionPreview = useAppStore((s) => s.setImageVersionPreview)
  useEffect(() => {
    if (!imageVersionPreview) return
    if (
      !previewTarget.previewPath ||
      !samePath(previewTarget.previewPath, imageVersionPreview.path)
    ) {
      setImageVersionPreview(null)
    }
  }, [previewTarget.previewPath, imageVersionPreview, setImageVersionPreview])

  useEffect(() => {
    void call(api.app.getVersion())
      .then((r) => setAppVersion(r.version))
      .catch(() => setAppVersion(null))
  }, [])

  // Window title follows the active tab; during slideshow, Alt can show the image name.
  useEffect(() => {
    if (!activeTab) return
    const ver = appVersion ? ` — v${appVersion}` : ''
    if (slideshowActive && titleFilename && slideshowPath) {
      document.title = `${slideshowPath} — MyFileExplorer${ver}`
      return
    }
    const folder =
      activeTab.title ??
      (isVirtualFolderDocumentPath(activeTab.path)
        ? virtualFolderDisplayName(activeTab.path)
        : basename(activeTab.path))
    document.title = `${folder} — MyFileExplorer${ver}`
  }, [
    activeTab,
    appVersion,
    slideshowActive,
    slideshowIndex,
    slideshowPath,
    titleFilename
  ])

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

    if (ctrl && shift && !alt && key.toLowerCase() === 't') {
      e.preventDefault()
      void s.reopenClosedTab(0)
    } else if (ctrl && !shift && key.toLowerCase() === 't') {
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
      // Match the toolbar / mouse Back action when history exists so the
      // saved sort, scroll position, and focused row are restored together.
      if (s.activeTab().back.length > 0) void s.goBack()
      else void s.goUp()
    } else if (key === 'F5' || (ctrl && !shift && !alt && key.toLowerCase() === 'r')) {
      // F5 and Ctrl+R — same in-app full refresh (not Chromium page reload).
      e.preventDefault()
      void s.refresh()
    } else if (key === 'F2') {
      if (s.recycleBin.active) return
      e.preventDefault()
      const inTree = isFolderTreeEventTarget(e.target)
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
      s.copySelection(pathsForClipboardShortcut(s, e.target))
    } else if (ctrl && !alt && key.toLowerCase() === 'x') {
      if (hasTextSelection()) return
      if (s.recycleBin.active) return
      e.preventDefault()
      s.cutSelection(pathsForClipboardShortcut(s, e.target))
    } else if (ctrl && shift && !alt && key.toLowerCase() === 'v') {
      if (s.recycleBin.active) return
      e.preventDefault()
      void s.pasteInto(s.activeTab().path, { planMode: true })
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
      const paths = isFolderTreeEventTarget(e.target)
        ? pathsForClipboardShortcut(s, e.target)
        : undefined
      void s.deleteSelection(shift, paths, ctrl)
    } else if (ctrl && !shift && !alt && key.toLowerCase() === 'e') {
      // Edit image — no selection / non-image: ignore (do not steal focus elsewhere).
      if (s.slideshow.active || s.imageEditor || s.recycleBin.active) return
      const sel = s.activeTab().selected
      const path = sel.length === 1 ? sel[0] : null
      if (!path || !isEditableImagePath(path)) return
      e.preventDefault()
      void (async () => {
        const res = await api.preview.get({ path })
        if (res.ok && res.value.mediaUrl) {
          useAppStore.getState().openImageEditor(path, res.value.mediaUrl)
        }
      })()
    } else if (ctrl && shift && !alt && key.toLowerCase() === 'f') {
      e.preventDefault()
      document.querySelector<HTMLInputElement>('[data-search-input]')?.focus()
    } else if (ctrl && !shift && !alt && key.toLowerCase() === 'f') {
      e.preventDefault()
      s.openDialog({ kind: 'power-search' })
    } else if (ctrl && shift && key.toLowerCase() === 'p') {
      e.preventDefault()
      const sp = useAppStore.getState().splitters
      useAppStore.getState().setSplitters({ previewCollapsed: !sp.previewCollapsed })
    } else if (ctrl && key.toLowerCase() === 'l') {
      e.preventDefault()
      s.setAddressEditing(true)
    } else if (key === 'Enter') {
      // Image viewer / slideshow own Enter (fit toggle / resume) while open.
      if (s.imageViewer || s.slideshow.active || s.imageEditor) return
      const sel = s.activeTab().selected
      if (sel.length >= 1) {
        e.preventDefault()
        if (s.recycleBin.active) {
          void s.restoreFromRecycleBinView(sel)
          return
        }
        // Same as double-click / context Open: single image → openEntry (full sibling
        // strip); multi all-images → viewer over the selection; else open each.
        const pool = s.search.active
          ? searchResultsToEntries(s.search.results)
          : s.listing.entries
        const selectedEntries = sel
          .map((p) => pool.find((en) => en.path.toLowerCase() === p.toLowerCase()))
          .filter((en): en is NonNullable<typeof en> => !!en)
        if (selectedEntries.length === 1) {
          void s.openEntry(selectedEntries[0]!)
          return
        }
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
    // Capture so Ctrl+R is handled before Chromium's default renderer reload.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onKeyDown])

  useEffect(() => {
    /** Dedupe Windows app-command + mouse X1/X2 when both fire for one click. */
    let lastNavAt = 0
    let lastNavDir: 'back' | 'forward' | null = null

    const tryHistoryNav = (dir: 'back' | 'forward', target?: EventTarget | null): void => {
      const s = useAppStore.getState()
      if (s.dialog || s.contextMenu) return
      if (s.renamingPath !== null || s.addressEditing) return
      if (target != null && isEditingTarget(target)) return
      const now = Date.now()
      if (dir === lastNavDir && now - lastNavAt < 250) return
      lastNavAt = now
      lastNavDir = dir
      if (dir === 'back') void s.goBack()
      else void s.goForward()
    }

    const onMouseHistoryNav = (e: MouseEvent): void => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      tryHistoryNav(e.button === 3 ? 'back' : 'forward', e.target)
    }

    window.addEventListener('mouseup', onMouseHistoryNav)
    window.addEventListener('auxclick', onMouseHistoryNav)
    const unsub = window.myFileExplorer.onEvent((event) => {
      if (event.type !== 'history-nav') return
      tryHistoryNav(event.payload.dir)
    })
    return () => {
      window.removeEventListener('mouseup', onMouseHistoryNav)
      window.removeEventListener('auxclick', onMouseHistoryNav)
      unsub()
    }
  }, [])

  /** Ctrl/⌘ + mouse wheel → Appearance font size + chrome icon size. */
  useEffect(() => {
    let accum = 0
    let pendingFont: number | null = null
    let pendingIcon: number | null = null
    let persistTimer: ReturnType<typeof setTimeout> | null = null

    const persist = (): void => {
      const font = pendingFont
      const icon = pendingIcon
      pendingFont = null
      pendingIcon = null
      if (font != null) void useAppStore.getState().applySettingsPatch({ fontSizePx: font })
      if (icon != null) void useAppStore.getState().applySettingsPatch({ iconSizePx: icon })
    }

    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const s = useAppStore.getState()
      if (!s.booted) return
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
      if (delta === 0) return
      // Trackpads send many small pixel deltas; notch wheels are larger / line mode.
      accum += delta
      const threshold = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 1 : 40
      if (Math.abs(accum) < threshold) return
      const step = accum > 0 ? -1 : 1
      accum = 0
      const curFont = pendingFont ?? s.settings.fontSizePx
      const curIcon = pendingIcon ?? s.settings.iconSizePx
      const nextFont = Math.min(FONT_SIZE_PX_MAX, Math.max(FONT_SIZE_PX_MIN, curFont + step))
      const nextIcon = Math.min(ICON_SIZE_PX_MAX, Math.max(ICON_SIZE_PX_MIN, curIcon + step))
      if (nextFont === curFont && nextIcon === curIcon) return
      pendingFont = nextFont
      pendingIcon = nextIcon
      useAppStore.setState({
        settings: { ...s.settings, fontSizePx: nextFont, iconSizePx: nextIcon }
      })
      document.documentElement.style.setProperty('--font-size', `${nextFont}px`)
      document.documentElement.style.setProperty('--icon-size', `${nextIcon}px`)
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(persist, 180)
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('wheel', onWheel)
      if (persistTimer) clearTimeout(persistTimer)
      persist()
    }
  }, [])

  return (
    <div className="shell">
      <TabBar />
      <Toolbar />
      <div className="shell-body">
        <div className="view-grid-host">
          {/* Unmount file grid while slideshow plays — large listings must not sit under the overlay. */}
          {slideshowActive ? null : <ViewGrid />}
        </div>
        {!slideshowActive && !splitters.previewCollapsed && (
          <>
            <Splitter
              onDrag={(delta) => {
                const sp = useAppStore.getState().splitters
                const max = maxPreviewWidthPx()
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
      {slideshowActive ? null : <StatusBar />}
      <ContextMenu />
      <GitFileHistoryHost />
      <Dialogs />
      <ImageViewer />
      <SlideshowOverlay />
      {imageEditorOpen ? (
        <Suspense fallback={null}>
          <ImageEditor />
        </Suspense>
      ) : null}
    </div>
  )
}
