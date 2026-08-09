import { create } from 'zustand'
import type {
  DirEntry,
  ConflictPolicy,
  ConflictDecision,
  ConflictItem,
  DriveInfo
} from '@shared/schemas/fs'
import type {
  SessionState,
  SortSpec,
  TabIcon,
  TabState,
  ViewMode,
  ViewLayout,
  Splitters
} from '@shared/schemas/session'
import { MAX_TREE_EXPANDED } from '@shared/schemas/session'
import { clampPaneRatio, fillPaneSlots, remapPanesOnLayoutChange } from '@shared/viewPanes'
import type { Settings, SettingsPatch } from '@shared/schemas/settings'
import type { IndexRootInfo, SearchResultItem } from '@shared/schemas/search'
import type { RecycleBinItem } from '@shared/schemas/recycle'
import type { MfeEvent } from '@shared/ipc/contract'
import {
  findExactFolderView,
  patchFolderView,
  removeFolderView,
  resolveFolderView,
  upsertFolderView,
  type FolderView
} from '@shared/folderViews'
import {
  buildLayoutFromSnapshot,
  removeLayout as removeLayoutFromList,
  renameLayout as renameLayoutInList,
  upsertLayout,
  type WorkspaceLayout
} from '@shared/layouts'
import { api, call, IpcError } from '../lib/ipc'
import { basename, parentOf, samePath, joinPath, driveOf, isUnderPath } from '../lib/paths'
import { isVolumeRootPath } from '../lib/rightDrag'
import {
  buildQuickAccess,
  materializeQuickAccessTokens,
  tokenForPath,
  type KnownFolder,
  type KnownFolderId,
  type QuickAccessEntry
} from '../lib/quickAccess'
import { isExcludedByViewFilter } from '../lib/viewFilter'
import { searchResultsToEntries } from '../lib/searchEntries'
import { recycleBinItemsToEntries } from '../lib/recycleBinEntries'
import { isImageExt } from '../lib/icons'
import { nextSelectionAfterDelete } from '../lib/nextSelection'
import {
  pushCapped,
  redoActionTitle,
  undoActionTitle,
  pathsAfterRedo,
  pathsAfterUndo,
  type UndoEntry
} from '../lib/undoHistory'

export type Tab = {
  id: string
  path: string
  title: string | null
  /** Optional Lucide icon (name + color) shown on the tab. */
  icon: TabIcon
  viewMode: ViewMode
  sort: SortSpec
  back: string[]
  forward: string[]
  selected: string[]
  scrollOffset: number
  /** Scoped tab: this folder is the tree root; navigation stays inside it. */
  rootPath: string | null
  /** Expanded folder-tree directories for this tab (persisted in session). */
  treeExpanded: string[]
}

export type Listing = {
  path: string
  entries: DirEntry[]
  loading: boolean
  error: string | null
  /** Path is unreachable (unmounted / encrypted / network) — keep tab, poll until back. */
  offline: boolean
}

export type ClipboardState = { mode: 'copy' | 'cut'; paths: string[] } | null

export type DialogState =
  | { kind: 'confirm-permanent-delete'; paths: string[] }
  | { kind: 'confirm-empty-recycle-bin' }
  | { kind: 'confirm-delete-from-recycle-bin'; paths: string[] }
  | {
      kind: 'conflict'
      op: 'copy' | 'move'
      sources: string[]
      destinationDir: string
      conflicts: string[]
      items: ConflictItem[]
      clearCutAfter: boolean
    }
  | { kind: 'new-file'; parent: string }
  | { kind: 'properties'; path: string }
  | { kind: 'settings'; section?: string }
  | {
      kind: 'layout-name'
      mode: 'save' | 'rename'
      layoutId?: string
      initialName?: string
      /** Re-open Settings on this section after success. */
      returnSection?: string
    }
  | { kind: 'tab-icon'; tabId: string }
  | { kind: 'alert'; title: string; message: string; detail?: string }
  | null

export type ContextMenuState = {
  x: number
  y: number
  /** paths the menu applies to; empty = folder background */
  paths: string[]
  inTree?: boolean
  /**
   * Right-button drag drop menu (Explorer: Copy / Move / Create shortcuts).
   * `paths` are the dragged items; `destDir` is the folder under the pointer.
   */
  dropTransfer?: { destDir: string }
} | null

export type SearchState = {
  active: boolean
  query: string
  running: boolean
  indexedOnly: boolean
  results: SearchResultItem[]
  partial: boolean
  source: 'index' | 'walk' | null
  /** Unindexed content: scan (D34 / D15). */
  contentSlow: boolean
  progress: string | null
}

/** In-app Recycle Bin overlay (like search — FileView shows bin items). */
export type RecycleBinState = {
  active: boolean
  loading: boolean
  items: RecycleBinItem[]
  truncated: boolean
}

export type Notice = { text: string; isError: boolean } | null

/** Live progress for copy / move / trash / permanent delete (main → op-progress). */
export type FileOpProgress = {
  opId: string
  kind: 'copy' | 'move' | 'trash' | 'delete' | 'relocate' | 'vid-thumbs' | 'zip'
  done: number
  total: number
  current?: string
  label?: string
  bytesDone?: number
  bytesTotal?: number
}

/** Show status-bar busy if an awaited FS op is still running after this delay. */
const BUSY_FEEDBACK_MS = 1000
let busyFeedbackSeq = 0
/** As-you-type search debounce (D34). */
const SEARCH_DEBOUNCE_MS = 280
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
let searchSeq = 0

let tabCounter = 0
function newTabId(): string {
  return `tab_${Date.now().toString(36)}_${(tabCounter++).toString(36)}`
}

const listRequestSeqByTab = new Map<string, number>()
function nextListSeq(tabId: string): number {
  const n = (listRequestSeqByTab.get(tabId) ?? 0) + 1
  listRequestSeqByTab.set(tabId, n)
  return n
}
/** Skip watch-driven soft re-lists after optimistic local mutations (large folders). */
let suppressSoftReloadUntil = 0
const softReloadTimers = new Map<string, ReturnType<typeof setTimeout>>()
const softReloadInFlight = new Set<string>()
const lastSoftReloadAtByPath = new Map<string, number>()

function emptyListing(path = ''): Listing {
  return { path, entries: [], loading: false, error: null, offline: false }
}
/** Above this, skip directory watches — soft re-lists dominate UI time. */
const LARGE_FOLDER_NO_WATCH = 2_000
/**
 * Cached view order for delete-next selection. Rebuilding via localeCompare on
 * 20k rows every Del is a multi-hundred-ms hitch; prune updates this in place.
 */
let viewOrderCache: {
  listingRef: DirEntry[]
  sortKey: string
  sortDir: string
  foldersFirst: boolean
  filterKey: string
  paths: string[]
} | null = null
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
let sessionSaveTimer: ReturnType<typeof setTimeout> | null = null
let noticeTimer: ReturnType<typeof setTimeout> | null = null

type AppState = {
  booted: boolean
  settings: Settings
  homePath: string
  /** Resolved known folders for Quick access (Desktop, Downloads, …). */
  knownFolders: KnownFolder[]
  drives: DriveInfo[]
  tabs: Tab[]
  activeTabId: string
  splitters: Splitters
  /** Multi-pane layout (D31): 1 | 2 side-by-side | 4 (2×2). */
  viewLayout: ViewLayout
  /** Tab id per pane slot; null = empty drop target. Length === viewLayout. */
  paneTabIds: (string | null)[]
  focusedPaneIndex: number
  paneSplitCols: number
  paneSplitRows: number
  /** Per-tab directory listings for visible panes. */
  listingsByTabId: Record<string, Listing>
  /** Listing for the active (focused) tab — mirrors listingsByTabId[activeTabId]. */
  listing: Listing
  selectionAnchor: string | null
  focusedPath: string | null
  renamingPath: string | null
  /**
   * Where the inline rename UI should appear. Folders exist in both the tree and
   * file view — only one surface mounts RenameInput so focus isn't stolen.
   */
  renameSource: 'tree' | 'files' | null
  /** Last folder clicked/focused in the tree (for F2 rename). */
  treeFocusPath: string | null
  clipboard: ClipboardState
  dragPaths: string[]
  /** Global drop-target folder while dragging (multi-pane highlight). */
  dropHighlightPath: string | null
  dialog: DialogState
  /** In-app full-size image viewer (double-click / Enter on images). */
  imageViewer: { path: string; siblings: string[] } | null
  /** In-app Filerobot image editor (preview Edit button / context menu). */
  imageEditor: { path: string; mediaUrl: string } | null
  /**
   * When true, preview/viewer detach AV/PDF media so Windows can delete/rename
   * files Chromium may still hold. Image previews use buffered/scratch mfe-media
   * (D7) and stay painted to avoid a black flash on delete.
   */
  mediaHold: boolean
  contextMenu: ContextMenuState
  search: SearchState
  recycleBin: RecycleBinState
  indexRoots: IndexRootInfo[]
  indexProgress: Record<string, number>
  /** Determinate progress for lengthy multi-file FS ops. */
  fileOp: FileOpProgress | null
  /**
   * Bumped when `!VIDTHUMB_CACHE` strips are generated so icon thumbs refetch.
   */
  videoThumbRev: number
  notice: Notice
  addressEditing: boolean
  /**
   * Bumped after FS mutations so the folder tree can prune removed nodes and/or
   * reload a parent's children (e.g. after mkdir / paste / rename).
   */
  treeMutation: { rev: number; removed: string[]; reloadParents: string[] }
  /**
   * Bumped by Refresh (F5) so the folder tree reloads every folder it has already
   * listed — listing alone does not update the tree cache.
   */
  treeRefreshRev: number
  /** In-memory Explorer-style undo stack (not persisted). */
  undoStack: UndoEntry[]
  redoStack: UndoEntry[]

  // derived helpers
  activeTab(): Tab

  // lifecycle
  boot(): Promise<void>

  // notices
  notify(text: string, isError?: boolean): void

  undo(): Promise<void>
  redo(): Promise<void>
  canUndo(): boolean
  canRedo(): boolean
  undoLabel(): string | null
  redoLabel(): string | null

  // navigation
  navigate(path: string, opts?: { push?: boolean; tabId?: string }): Promise<void>
  goBack(): Promise<void>
  goForward(): Promise<void>
  goUp(): Promise<void>
  refresh(): Promise<void>
  setAddressEditing(v: boolean): void
  /** Clear Back/Forward stacks for a tab (address-bar Recent locations). */
  clearHistory(tabId?: string): void

  // tabs
  newTab(path?: string, rootPath?: string): Promise<void>
  /** Duplicate a tab (same path/view/title/icon; fresh history/selection). */
  duplicateTab(id: string): Promise<void>
  /** Open/reveal a path from CLI or another app (new or existing tab). */
  openExternalTarget(path: string, reveal: boolean): Promise<void>
  closeTab(id: string): Promise<void>
  activateTab(id: string): Promise<void>
  nextTab(): Promise<void>
  renameTab(id: string, title: string | null): void
  setTabIcon(id: string, icon: TabIcon): void
  reorderTab(fromIndex: number, toIndex: number): void

  // multi-pane (D31)
  setViewLayout(mode: ViewLayout): Promise<void>
  focusPane(index: number): void
  assignTabToPane(paneIndex: number, tabId: string | null): Promise<void>
  setPaneSplitCols(ratio: number): void
  setPaneSplitRows(ratio: number): void
  /** Listing for a tab (pane); falls back to empty. */
  listingForTab(tabId: string): Listing

  // view state
  setViewMode(mode: ViewMode, tabId?: string): void
  setSort(sort: SortSpec, tabId?: string): void
  setScrollOffset(offset: number, tabId?: string): void
  /** Persist folder-tree expansion for a tab (default: active). */
  setTreeExpanded(paths: string[], tabId?: string): void
  setSplitters(patch: Partial<Splitters>): void
  /** Owning folder-view override for a path (exact or recursive ancestor). */
  owningFolderView(path?: string): FolderView | null
  customizeFolderView(path: string, recursive: boolean): Promise<void>
  removeFolderCustomization(path: string): Promise<void>
  setFolderViewRecursive(path: string, recursive: boolean): Promise<void>
  /** Patch Details layout on owning folder view, or global settings if none. */
  patchDetailsLayout(patch: {
    detailsColumns?: Settings['detailsColumns']
    detailsNameWidth?: number
  }): Promise<void>

  /** Save current tabs + chrome as a new named layout (or overwrite via updateLayout). */
  saveLayout(name: string): Promise<WorkspaceLayout | null>
  /** Overwrite an existing layout with the current workspace. */
  updateLayout(id: string): Promise<void>
  renameLayout(id: string, name: string): Promise<void>
  removeLayout(id: string): Promise<void>
  /** Replace live tabs/splitters with a saved layout (regenerates tab ids). */
  applyLayout(id: string): Promise<void>

  // selection
  setSelection(
    paths: string[],
    anchor?: string | null,
    focused?: string | null,
    tabId?: string
  ): void
  selectAll(tabId?: string): void

  // fs ops
  startRename(path: string, source?: 'tree' | 'files'): void
  submitRename(newName: string): Promise<void>
  cancelRename(): void
  setTreeFocusPath(path: string | null): void
  createFolder(parent?: string): Promise<void>
  createNewFile(parent: string, name: string): Promise<void>
  /** Create “New …ext” with a unique name and start inline rename. */
  createTypedFile(parent: string, stem: string, ext: string): Promise<void>
  /** Copy paths to in-app + OS file clipboard. Defaults to the file-view selection. */
  copySelection(paths?: string[]): void
  /** Cut paths to in-app + OS file clipboard. Defaults to the file-view selection. */
  cutSelection(paths?: string[]): void
  paste(): Promise<void>
  performTransfer(
    op: 'copy' | 'move',
    sources: string[],
    destinationDir: string,
    clearCutAfter?: boolean
  ): Promise<void>
  /** Right-drag “Create shortcuts here” — write .lnk files pointing at sources. */
  createShortcutsHere(sources: string[], destinationDir: string): Promise<void>
  /** Compress selection (or explicit paths) to a sibling `.zip` like Explorer. */
  compressToZip(paths?: string[]): Promise<void>
  /** Extract selected `.zip` archives into sibling folders (Extract All…). */
  extractZip(paths?: string[]): Promise<void>
  /**
   * Conflict dialog result: cancel, one batch policy for all, or per-name decisions.
   * Non-conflicting sources always transfer.
   */
  resolveConflict(
    choice: null | ConflictDecision | Record<string, ConflictDecision>
  ): Promise<void>
  /** Delete file-view selection, or explicit `paths` (e.g. tree-focused folder). */
  deleteSelection(permanent: boolean, paths?: string[]): Promise<void>
  confirmPermanentDelete(confirmed: boolean): Promise<void>
  openEntry(entry: DirEntry): Promise<void>
  openPath(path: string): Promise<void>
  /**
   * Search: open the item’s location in this app (folder → navigate there;
   * file → parent folder + select the file).
   */
  openFileLocation(path: string): Promise<void>
  /** Search: open location in a new tab (file → parent tab + selection). */
  openFileInNewTab(path: string): Promise<void>
  openImageViewer(path: string, siblings?: string[]): void
  closeImageViewer(): void
  openImageEditor(path: string, mediaUrl: string): void
  closeImageEditor(): void
  /** Save Filerobot output over the live file (pristine backup under userData). */
  saveEditedImage(path: string, dataBase64: string): Promise<void>
  /** Save to a new path via dialog — no original backup. */
  saveEditedImageAs(sourcePath: string, dataBase64: string): Promise<string | null>
  revertImageOriginal(path: string): Promise<void>
  imageViewerNavigate(delta: number | 'first' | 'last'): void
  /** Delete the image currently shown in the viewer (Del → trash, Shift+Del → permanent). */
  imageViewerDelete(permanent: boolean): Promise<void>
  showInExplorer(path: string): Promise<void>
  copyPathsToClipboard(paths: string[], nameOnly: boolean): Promise<void>

  // drag & drop
  setDragPaths(paths: string[]): void
  setDropHighlight(path: string | null): void

  // dialogs / menus
  openDialog(dialog: DialogState): void
  closeDialog(): void
  openContextMenu(menu: ContextMenuState): void
  closeContextMenu(): void

  // settings
  applySettingsPatch(patch: SettingsPatch): Promise<void>
  addViewFilterPatterns(patterns: string[]): Promise<void>
  clearThumbCache(): Promise<void>
  /**
   * Generate `!VIDTHUMB_CACHE` strip frames for videos (or videos in folders).
   * `missing` skips only complete 20-frame strips (partials are cleared and redone);
   * `all` regenerates everything.
   * `recursive` walks subfolders when paths include directories.
   */
  generateVideoThumbs(
    paths: string[],
    mode: 'missing' | 'all',
    opts?: { recursive?: boolean }
  ): Promise<void>

  // Quick access
  quickAccessEntries(): QuickAccessEntry[]
  pinQuickAccess(path: string): Promise<void>
  unpinQuickAccess(path: string): Promise<void>
  reorderQuickAccess(fromIndex: number, toIndex: number): Promise<void>
  resetQuickAccess(): Promise<void>

  // search
  setSearchQuery(q: string): void
  setSearchIndexedOnly(v: boolean): void
  runSearch(): Promise<void>
  clearSearch(): void
  addIndexRootAction(path: string): Promise<void>
  addVolumeRootAction(path: string): Promise<void>
  removeIndexRootAction(path: string): Promise<void>
  reindexAction(path?: string): Promise<void>
  refreshIndexRoots(): Promise<void>

  // recycle bin (in-app view)
  openRecycleBinView(): Promise<void>
  closeRecycleBinView(): void
  refreshRecycleBinView(): Promise<void>
  restoreFromRecycleBinView(paths?: string[]): Promise<void>
  emptyRecycleBinView(): void
  confirmEmptyRecycleBin(confirmed: boolean): Promise<void>
  deleteFromRecycleBinView(paths?: string[]): void
  confirmDeleteFromRecycleBin(confirmed: boolean): Promise<void>
}

/** Unique child name: `stem` / `stem (2)` + optional extension (e.g. `.txt`). */
async function uniqueChildName(parent: string, stem: string, ext: string): Promise<string> {
  let name = `${stem}${ext}`
  for (let i = 2; ; i++) {
    const exists = (await call(api.fs.exists({ path: joinPath(parent, name) }))).exists
    if (!exists) return name
    name = `${stem} (${i})${ext}`
  }
}

function tabToSessionTab(t: Tab): TabState {
  return {
    id: t.id,
    path: t.path,
    title: t.title,
    icon: t.icon,
    viewMode: t.viewMode,
    sort: t.sort,
    rootPath: t.rootPath,
    historyBack: t.back,
    historyForward: t.forward,
    selectedPaths: t.selected,
    scrollOffset: t.scrollOffset,
    treeExpanded: t.treeExpanded
  }
}

function sessionTabToTab(t: TabState): Tab {
  return {
    id: t.id,
    path: t.path,
    title: t.title,
    icon: t.icon,
    viewMode: t.viewMode,
    sort: t.sort,
    back: t.historyBack,
    forward: t.historyForward,
    selected: t.selectedPaths,
    scrollOffset: t.scrollOffset,
    rootPath: t.rootPath,
    treeExpanded: t.treeExpanded
  }
}

function focusFromSelection(selected: string[]): {
  selectionAnchor: string | null
  focusedPath: string | null
} {
  if (selected.length === 0) return { selectionAnchor: null, focusedPath: null }
  return {
    selectionAnchor: selected[0] ?? null,
    focusedPath: selected[selected.length - 1] ?? null
  }
}

function sameExpandedSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a.map((p) => p.toLowerCase()))
  return b.every((p) => set.has(p.toLowerCase()))
}

export const useAppStore = create<AppState>()((set, get) => {
  function scheduleSessionSave(): void {
    if (sessionSaveTimer) clearTimeout(sessionSaveTimer)
    sessionSaveTimer = setTimeout(() => {
      const s = get()
      if (!s.booted) return
      const session: SessionState = {
        version: 1,
        activeTabId: s.activeTabId,
        tabs: s.tabs.map(tabToSessionTab),
        splitters: s.splitters,
        viewLayout: s.viewLayout,
        paneTabIds: s.paneTabIds,
        focusedPaneIndex: s.focusedPaneIndex,
        paneSplitCols: s.paneSplitCols,
        paneSplitRows: s.paneSplitRows
      }
      void api.session.set(session)
    }, 500)
  }

  function syncActiveListing(listingsByTabId: Record<string, Listing>, activeTabId: string): Listing {
    return listingsByTabId[activeTabId] ?? emptyListing()
  }

  /** Reload listings for every tab currently shown in a pane. */
  async function loadVisiblePaneListings(opts?: {
    preserveSelection?: boolean
    soft?: boolean
  }): Promise<void> {
    const s = get()
    const ids = [...new Set(s.paneTabIds.filter((id): id is string => id != null))]
    await Promise.all(
      ids.map((tabId) => {
        const tab = s.tabs.find((t) => t.id === tabId)
        return tab
          ? loadListing(tab.path, { ...opts, tabId })
          : Promise.resolve()
      })
    )
  }

  const OFFLINE_POLL_MS = 8_000
  /** Tree Drives list — live mounts only (not Offline-tab retry). */
  const DRIVE_POLL_MS = 3_000
  let offlinePollTimer: ReturnType<typeof setInterval> | null = null
  let offlinePollPath: string | null = null
  let drivePollTimer: ReturnType<typeof setInterval> | null = null

  function stopOfflinePoll(): void {
    if (offlinePollTimer) {
      clearInterval(offlinePollTimer)
      offlinePollTimer = null
    }
    offlinePollPath = null
  }

  function drivesKey(list: DriveInfo[]): string {
    return list.map((d) => `${d.path.toLowerCase()}|${d.label}`).join('\n')
  }

  function startDrivePoll(): void {
    if (drivePollTimer) return
    drivePollTimer = setInterval(() => {
      if (!get().booted) return
      void (async () => {
        try {
          const d = await call(api.fs.listDrives())
          if (drivesKey(get().drives) !== drivesKey(d.drives)) {
            set({ drives: d.drives })
          }
        } catch {
          // ignore transient list failures
        }
      })()
    }, DRIVE_POLL_MS)
  }

  function isOfflineFailure(e: unknown): boolean {
    if (!(e instanceof IpcError)) return true
    // Unmounted / encrypted / network volumes usually surface as these.
    return (
      e.code === 'not-found' ||
      e.code === 'not-allowed' ||
      e.code === 'busy' ||
      e.code === 'io'
    )
  }

  function startOfflinePoll(path: string, tabId: string): void {
    if (offlinePollTimer && offlinePollPath && samePath(offlinePollPath, path)) return
    stopOfflinePoll()
    offlinePollPath = path
    offlinePollTimer = setInterval(() => {
      const s = get()
      const listing = s.listingsByTabId[tabId]
      if (!s.booted || !listing?.offline || !samePath(listing.path, path)) {
        stopOfflinePoll()
        return
      }
      // Tab Offline retry only — tree drives refresh via startDrivePoll.
      void loadListing(path, { preserveSelection: true, soft: true, tabId })
    }, OFFLINE_POLL_MS)
  }

  /**
   * After BUSY_FEEDBACK_MS, show an indeterminate status-bar busy state if main
   * has not already pushed real `op-progress`. Clears local busy when `work` ends.
   */
  async function withBusyFeedback<T>(
    kind: FileOpProgress['kind'],
    label: string,
    current: string | undefined,
    work: () => Promise<T>
  ): Promise<T> {
    const localId = `local-${kind}-${++busyFeedbackSeq}`
    let active = true
    const timer = setTimeout(() => {
      if (!active) return
      const cur = get().fileOp
      if (cur && !cur.opId.startsWith('local-')) return
      set({
        fileOp: {
          opId: localId,
          kind,
          done: 0,
          total: 0,
          current,
          label
        }
      })
    }, BUSY_FEEDBACK_MS)
    try {
      return await work()
    } finally {
      active = false
      clearTimeout(timer)
      set((s) => (s.fileOp?.opId === localId ? { fileOp: null } : {}))
    }
  }

  async function executeTransfer(
    op2: 'copy' | 'move',
    src: string[],
    dest: string,
    policy: ConflictPolicy,
    clearCut: boolean
  ): Promise<void> {
    if (op2 === 'move') await releaseMediaLocks()
    try {
      const r = await withBusyFeedback(
        op2,
        op2 === 'copy' ? 'Copying…' : 'Moving…',
        src.length === 1 ? basename(src[0]!) : `${src.length} items`,
        () => runTransfer(op2, src, dest, policy)
      )
      if (op2 === 'copy') {
        if (r.copyPaths.length > 0) {
          recordUndo({ kind: 'copy', paths: r.copyPaths, label: basename(r.copyPaths[0]!) })
        }
        get().notify(`Copied ${r.copied}, skipped ${r.skipped}`)
        notifyTreeReload([dest])
      } else {
        if (r.movePairs.length > 0) {
          recordUndo({
            kind: 'move',
            pairs: r.movePairs,
            label: basename(r.movePairs[0]!.to)
          })
        }
        get().notify(`Moved ${r.moved}, skipped ${r.skipped}`)
        notifyTreeMutation({ removed: src, reloadParents: [dest] })
      }
      if (clearCut) set({ clipboard: null })
      if (get().mediaHold) set({ mediaHold: false })
      await get().refresh()
    } catch (e) {
      set({ mediaHold: false })
      throw e
    }
  }

  async function runTransfer(
    op2: 'copy' | 'move',
    src: string[],
    dest: string,
    policy: ConflictPolicy
  ): Promise<{
    copied: number
    moved: number
    skipped: number
    copyPaths: string[]
    movePairs: { from: string; to: string }[]
  }> {
    if (src.length === 0) {
      return { copied: 0, moved: 0, skipped: 0, copyPaths: [], movePairs: [] }
    }
    if (op2 === 'copy') {
      const res = await call(
        api.fs.copy({ sources: src, destinationDir: dest, conflictPolicy: policy })
      )
      return {
        copied: res.copied.length,
        moved: 0,
        skipped: res.skipped.length,
        copyPaths: res.copied,
        movePairs: []
      }
    }
    const res = await call(
      api.fs.move({ sources: src, destinationDir: dest, conflictPolicy: policy })
    )
    return {
      copied: 0,
      moved: res.moved.length,
      skipped: res.skipped.length,
      copyPaths: [],
      movePairs: res.moves
    }
  }

  async function loadListing(
    path: string,
    opts?: { preserveSelection?: boolean; soft?: boolean; tabId?: string }
  ): Promise<void> {
    const tabId = opts?.tabId ?? get().activeTabId
    if (!tabId) return
    const seq = nextListSeq(tabId)
    if (!opts?.soft) {
      set((s) => {
        const prev = s.listingsByTabId[tabId] ?? emptyListing(path)
        const nextListing: Listing = {
          ...prev,
          path,
          loading: true,
          error: null,
          offline: false
        }
        const listingsByTabId = { ...s.listingsByTabId, [tabId]: nextListing }
        return {
          listingsByTabId,
          listing: tabId === s.activeTabId ? nextListing : s.listing
        }
      })
    }
    try {
      const res = await call(api.fs.list({ path, includeHidden: true }))
      if (seq !== listRequestSeqByTab.get(tabId)) return // superseded
      if (opts?.soft) lastSoftReloadAtByPath.set(path.toLowerCase(), Date.now())
      const tab = get().tabs.find((t) => t.id === tabId) ?? get().activeTab()
      const owning = resolveFolderView(tab.path, get().settings.folderViews)
      const sort = owning?.sort ?? tab.sort
      const sortedEntries = sortEntries(res.entries, sort, get().settings.foldersFirst)
      const nextListing: Listing = {
        path: res.path,
        entries: sortedEntries,
        loading: false,
        error: null,
        offline: false
      }
      set((s) => {
        const valid = new Set(sortedEntries.map((e) => e.path.toLowerCase()))
        const tabs = s.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                selected: opts?.preserveSelection
                  ? t.selected.filter((p) => valid.has(p.toLowerCase()))
                  : t.selected
              }
            : t
        )
        const listingsByTabId = { ...s.listingsByTabId, [tabId]: nextListing }
        return {
          listingsByTabId,
          listing: tabId === s.activeTabId ? nextListing : syncActiveListing(listingsByTabId, s.activeTabId),
          tabs
        }
      })
      if (get().activeTabId === tabId) stopOfflinePoll()
      // Large libraries: watching forces periodic full re-lists (even coalesced)
      // and is the main source of multi-second freezes. Rely on optimistic
      // mutations + F5 / navigation instead.
      if (res.entries.length < LARGE_FOLDER_NO_WATCH) {
        void api.fs.watch({ path })
        const parent = parentOf(path)
        if (parent) void api.fs.watch({ path: parent })
      } else {
        void api.fs.unwatch({ path }).catch(() => {})
        const parent = parentOf(path)
        if (parent) void api.fs.unwatch({ path: parent }).catch(() => {})
      }
      if (tabId === get().activeTabId) {
        viewOrderCache = null
        queueMicrotask(() => {
          try {
            pathsInViewOrder()
          } catch {
            /* ignore */
          }
        })
      }
    } catch (e) {
      if (seq !== listRequestSeqByTab.get(tabId)) return
      const offline = isOfflineFailure(e)
      const message = e instanceof IpcError ? e.message : String(e)
      const nextListing: Listing = {
        path,
        entries: [],
        loading: false,
        error: offline ? null : message,
        offline
      }
      set((s) => {
        const listingsByTabId = { ...s.listingsByTabId, [tabId]: nextListing }
        return {
          listingsByTabId,
          listing: tabId === s.activeTabId ? nextListing : s.listing
        }
      })
      if (offline && tabId === get().activeTabId) startOfflinePoll(path, tabId)
      else if (tabId === get().activeTabId) stopOfflinePoll()
    }
  }

  function updateTab(tabId: string, patch: Partial<Tab>): void {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t))
    }))
    scheduleSessionSave()
  }

  function updateActiveTab(patch: Partial<Tab>): void {
    updateTab(get().activeTabId, patch)
  }

  /** Always surface FS failures in a modal — never status-bar-only. */
  function reportOperationError(title: string, e: unknown): void {
    if (e instanceof IpcError && e.code === 'cancelled') {
      get().notify('Cancelled')
      return
    }
    const message = e instanceof IpcError ? e.message : String(e)
    const detail = e instanceof IpcError ? e.envelope.remediation : undefined
    set({ dialog: { kind: 'alert', title, message, detail } })
    get().notify(message.split('\n')[0] ?? message, true)
  }

  function notifyTreeMutation(opts: { removed?: string[]; reloadParents?: string[] }): void {
    set((s) => ({
      treeMutation: {
        rev: s.treeMutation.rev + 1,
        removed: opts.removed ? [...opts.removed] : [],
        reloadParents: opts.reloadParents ? [...opts.reloadParents] : []
      }
    }))
  }

  function notifyTreeRemoved(removed: string[]): void {
    notifyTreeMutation({ removed })
  }

  function notifyTreeReload(parents: string[]): void {
    if (parents.length === 0) return
    notifyTreeMutation({ reloadParents: parents })
  }

  /**
   * Coalesce watch-driven soft reloads. Large folders must not re-list on every
   * ReadDirectoryChanges blip (indexer / AV / our own enumeration noise).
   */
  function scheduleSoftReload(dirPath: string): void {
    if (Date.now() < suppressSoftReloadUntil) return
    const s = get()
    let targets = s.tabs.filter(
      (t) =>
        s.paneTabIds.includes(t.id) &&
        (samePath(t.path, dirPath) ||
          samePath(s.listingsByTabId[t.id]?.path ?? '', dirPath))
    )
    if (targets.length === 0) {
      // Fallback: active tab only (e.g. layout 1).
      if (!samePath(s.activeTab().path, dirPath)) return
      targets = [s.activeTab()]
    }
    for (const tab of targets) {
      const key = tab.id
      const listing = s.listingsByTabId[tab.id]
      const n = listing?.entries.length ?? 0
      const minGap = n >= 10_000 ? 10_000 : n >= 2_000 ? 5_000 : 750
      const last = lastSoftReloadAtByPath.get(dirPath.toLowerCase()) ?? 0
      const wait = Math.max(250, last + minGap - Date.now())
      const prev = softReloadTimers.get(key)
      if (prev) clearTimeout(prev)
      softReloadTimers.set(
        key,
        setTimeout(() => {
          softReloadTimers.delete(key)
          if (Date.now() < suppressSoftReloadUntil) return
          if (softReloadInFlight.has(key)) return
          const cur = get().tabs.find((t) => t.id === tab.id)
          if (!cur || !samePath(cur.path, dirPath)) return
          softReloadInFlight.add(key)
          void loadListing(dirPath, { preserveSelection: true, soft: true, tabId: tab.id }).finally(
            () => {
              softReloadInFlight.delete(key)
            }
          )
        }, wait)
      )
    }
  }

  /**
   * After trash/delete: prune the tree, and if the active folder was removed
   * (or lived inside a removed folder), navigate to the next sibling folder
   * under the parent — or the parent itself when there is no next sibling.
   */
  function syncImageViewerAfterDelete(removed: string[]): void {
    const v = get().imageViewer
    if (!v) return
    const gone = (p: string): boolean =>
      removed.some((r) => samePath(p, r) || isUnderPath(p, r))
    const siblings = v.siblings.filter((p) => !gone(p))
    if (!gone(v.path)) {
      if (siblings.length !== v.siblings.length) {
        set({ imageViewer: { path: v.path, siblings } })
      }
      return
    }
    if (siblings.length === 0) {
      set({ imageViewer: null })
      return
    }
    const oldIdx = v.siblings.findIndex((p) => samePath(p, v.path))
    const nextIdx = Math.min(Math.max(oldIdx, 0), siblings.length - 1)
    set({ imageViewer: { path: siblings[nextIdx]!, siblings } })
  }

  /** Drop AV/PDF media elements so Chromium releases any remaining holds. */
  async function releaseMediaLocks(): Promise<void> {
    set({ mediaHold: true })
    // Two animation frames is enough for React to unmount <video>/<audio>/PDF.
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve())
      })
    })
  }

  function clearMediaHold(): void {
    if (get().mediaHold) set({ mediaHold: false })
  }

  function viewOrderFilterKey(s: {
    settings: { viewFilterEnabled: boolean; viewFilterPatterns: string[] }
  }): string {
    return `${s.settings.viewFilterEnabled ? 1 : 0}|${s.settings.viewFilterPatterns.join('\n')}`
  }

  /** Sorted/filtered paths matching the file view (cached; pruned in place on delete). */
  function pathsInViewOrder(): string[] {
    const s = get()
    const tab = s.activeTab()
    const owning = resolveFolderView(tab.path, s.settings.folderViews)
    const sort = owning?.sort ?? tab.sort
    const filterKey = viewOrderFilterKey(s)
    if (
      viewOrderCache &&
      viewOrderCache.listingRef === s.listing.entries &&
      viewOrderCache.sortKey === sort.key &&
      viewOrderCache.sortDir === sort.dir &&
      viewOrderCache.foldersFirst === s.settings.foldersFirst &&
      viewOrderCache.filterKey === filterKey
    ) {
      return viewOrderCache.paths
    }
    const before = sortEntries(
      s.listing.entries.filter(
        (e) => !isExcludedByViewFilter(e, s.settings.viewFilterPatterns, s.settings.viewFilterEnabled)
      ),
      sort,
      s.settings.foldersFirst
    )
    const paths = before.map((e) => e.path)
    viewOrderCache = {
      listingRef: s.listing.entries,
      sortKey: sort.key,
      sortDir: sort.dir,
      foldersFirst: s.settings.foldersFirst,
      filterKey,
      paths
    }
    return paths
  }

  /** Next path to select after delete, from the current sorted/filtered listing. */
  function nextPathAfterDelete(removed: string[]): string | null {
    return nextSelectionAfterDelete(pathsInViewOrder(), removed)
  }

  /** Drop removed paths from in-memory listings (no full-folder re-stat). */
  function pruneListingRemoved(removed: string[]): void {
    if (removed.length === 0) return
    const gone = new Set(removed.map((p) => p.toLowerCase()))
    set((s) => {
      const listingsByTabId: Record<string, Listing> = {}
      for (const [tid, L] of Object.entries(s.listingsByTabId)) {
        listingsByTabId[tid] = {
          ...L,
          entries: L.entries.filter((e) => !gone.has(e.path.toLowerCase()))
        }
      }
      const activeListing = listingsByTabId[s.activeTabId] ?? {
        ...s.listing,
        entries: s.listing.entries.filter((e) => !gone.has(e.path.toLowerCase()))
      }
      if (viewOrderCache && viewOrderCache.listingRef === s.listing.entries) {
        viewOrderCache = {
          ...viewOrderCache,
          listingRef: activeListing.entries,
          paths: viewOrderCache.paths.filter((p) => !gone.has(p.toLowerCase()))
        }
      } else {
        viewOrderCache = null
      }
      return { listingsByTabId, listing: activeListing }
    })
    // Avoid the delete's own directory-watch event re-listing tens of thousands of files.
    suppressSoftReloadUntil = Math.max(suppressSoftReloadUntil, Date.now() + 8000)
  }

  /** Move selection to the survivor and drop cards before trash/refresh so UI stays snappy. */
  function selectAfterDelete(removed: string[]): string | null {
    const tab = get().activeTab()
    // Deleting the folder we're in (or an ancestor): navigation handles next view.
    if (removed.some((p) => samePath(p, tab.path) || isUnderPath(tab.path, p))) {
      return null
    }
    const nextPath = nextPathAfterDelete(removed)
    pruneListingRemoved(removed)
    if (nextPath) {
      updateActiveTab({ selected: [nextPath] })
      set({ selectionAnchor: nextPath, focusedPath: nextPath })
    } else {
      updateActiveTab({ selected: [] })
      set({ selectionAnchor: null, focusedPath: null })
    }
    return nextPath
  }

  async function afterPathsRemoved(removed: string[]): Promise<void> {
    syncImageViewerAfterDelete(removed)
    notifyTreeRemoved(removed)
    const tab = get().activeTab()
    const current = tab.path
    const primary =
      removed.find((p) => samePath(p, current) || isUnderPath(current, p)) ?? null

    if (!primary) {
      // Stay in-folder: listing was already pruned + selection updated before trash.
      // Do NOT full-refresh — readdir+stat of large folders is multi-second.
      pruneListingRemoved(removed)
      const focused = get().focusedPath
      const nextPath =
        focused && get().listing.entries.some((e) => samePath(e.path, focused))
          ? focused
          : null
      if (nextPath) {
        updateActiveTab({ selected: [nextPath] })
        set({ selectionAnchor: nextPath, focusedPath: nextPath })
      } else {
        updateActiveTab({ selected: [] })
        set({ selectionAnchor: null, focusedPath: null })
      }
      clearMediaHold()
      return
    }

    const parent = parentOf(primary)
    if (!parent) {
      const fallback = get().homePath || get().settings.defaultNewTabPath
      if (fallback) await get().navigate(fallback)
      return
    }

    let nextPath = parent
    try {
      const res = await call(api.fs.list({ path: parent, includeHidden: true }))
      const dirs = res.entries
        .filter((e) => e.kind === 'dir')
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        )
      const primaryName = basename(primary)
      const nextSibling = dirs.find(
        (d) =>
          d.name.localeCompare(primaryName, undefined, {
            numeric: true,
            sensitivity: 'base'
          }) > 0
      )
      if (nextSibling) nextPath = nextSibling.path
    } catch {
      // parent list failed — still try to open parent
    }

    // Scoped tab whose root was deleted: drop the scope so we can leave it.
    if (
      tab.rootPath &&
      (samePath(tab.rootPath, primary) || isUnderPath(tab.rootPath, primary))
    ) {
      updateActiveTab({ rootPath: null })
    }

    await get().navigate(nextPath)
    // Don't leave deleted folders in back/forward history.
    const gone = (p: string): boolean =>
      removed.some((r) => samePath(p, r) || isUnderPath(p, r))
    const t = get().activeTab()
    updateActiveTab({
      back: t.back.filter((p) => !gone(p)),
      forward: t.forward.filter((p) => !gone(p)),
      selected: []
    })
    clearMediaHold()
  }

  let historyBusy = false

  function recordUndo(entry: UndoEntry): void {
    if (historyBusy) return
    set((s) => ({
      undoStack: pushCapped(s.undoStack, entry),
      redoStack: []
    }))
  }

  function parentsOfPaths(paths: string[]): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    for (const p of paths) {
      const parent = parentOf(p)
      if (!parent) continue
      const key = parent.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(parent)
    }
    return out
  }

  /** Commit in-progress inline rename before tearing UI down (navigate / tab switch). */
  function flushPendingRename(): void {
    if (!get().renamingPath) return
    const el = document.querySelector('input.rename-input') as HTMLInputElement | null
    if (el) {
      void get().submitRename(el.value)
      return
    }
    get().cancelRename()
  }

  async function selectPathsPreferParent(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      updateActiveTab({ selected: [] })
      set({ selectionAnchor: null, focusedPath: null })
      await get().refresh()
      return
    }
    const parent = parentOf(paths[0]!)
    if (parent && !samePath(parent, get().activeTab().path)) {
      await get().navigate(parent)
    } else {
      await get().refresh()
    }
    const existing = paths.filter((p) =>
      get().listing.entries.some((e) => samePath(e.path, p))
    )
    if (existing.length > 0) {
      get().setSelection(existing, existing[0], existing[0])
    } else {
      updateActiveTab({ selected: [] })
      set({ selectionAnchor: null, focusedPath: null })
    }
  }

  async function applyHistoryEntry(entry: UndoEntry, direction: 'undo' | 'redo'): Promise<void> {
    if (entry.kind === 'trash') {
      if (direction === 'undo') {
        const res = await withBusyFeedback(
          'trash',
          'Restoring…',
          entry.label,
          () => call(api.fs.restoreFromTrash({ paths: entry.paths }))
        )
        if (res.restored.length === 0) {
          throw new IpcError({
            code: 'io',
            message:
              res.missing.length > 0
                ? 'Could not restore from Recycle Bin (item not found or restore failed).'
                : 'Could not restore from Recycle Bin.'
          })
        }
        notifyTreeReload(parentsOfPaths(res.restored))
        if (res.missing.length > 0) {
          get().notify(
            `Restored ${res.restored.length}; ${res.missing.length} not found in Recycle Bin`,
            true
          )
        }
        await selectPathsPreferParent(pathsAfterUndo(entry).filter((p) =>
          res.restored.some((r) => samePath(r, p))
        ))
        return
      }
      await withBusyFeedback('trash', 'Moving to Recycle Bin…', entry.label, () =>
        call(api.fs.trash({ paths: entry.paths }))
      )
      await afterPathsRemoved(entry.paths)
      return
    }

    if (entry.kind === 'create' || entry.kind === 'copy') {
      if (direction === 'undo') {
        await withBusyFeedback('trash', 'Moving to Recycle Bin…', entry.label, () =>
          call(api.fs.trash({ paths: entry.paths }))
        )
        await afterPathsRemoved(entry.paths)
        return
      }
      const res = await withBusyFeedback('trash', 'Restoring…', entry.label, () =>
        call(api.fs.restoreFromTrash({ paths: entry.paths }))
      )
      notifyTreeReload(parentsOfPaths(res.restored))
      await selectPathsPreferParent(
        pathsAfterRedo(entry).filter((p) => res.restored.some((r) => samePath(r, p)))
      )
      return
    }

    if (entry.kind === 'rename') {
      const pairs =
        direction === 'undo'
          ? [{ from: entry.to, to: entry.from }]
          : [{ from: entry.from, to: entry.to }]
      await withBusyFeedback('relocate', 'Moving…', entry.label, () =>
        call(api.fs.relocate({ pairs }))
      )
      notifyTreeMutation({
        removed: [pairs[0]!.from],
        reloadParents: parentsOfPaths([pairs[0]!.from, pairs[0]!.to])
      })
      await selectPathsPreferParent(direction === 'undo' ? pathsAfterUndo(entry) : pathsAfterRedo(entry))
      return
    }

    // move
    const pairs =
      direction === 'undo'
        ? entry.pairs.map((p) => ({ from: p.to, to: p.from }))
        : entry.pairs.map((p) => ({ from: p.from, to: p.to }))
    await withBusyFeedback(
      'relocate',
      'Moving…',
      entry.label ?? (pairs.length === 1 ? basename(pairs[0]!.from) : `${pairs.length} items`),
      () => call(api.fs.relocate({ pairs }))
    )
    notifyTreeMutation({
      removed: pairs.map((p) => p.from),
      reloadParents: parentsOfPaths(pairs.flatMap((p) => [p.from, p.to]))
    })
    await selectPathsPreferParent(direction === 'undo' ? pathsAfterUndo(entry) : pathsAfterRedo(entry))
  }

  return {
    booted: false,
    settings: null as unknown as Settings, // set during boot before UI renders
    homePath: '',
    knownFolders: [],
    drives: [],
    tabs: [],
    activeTabId: '',
    splitters: {
      treeWidthPx: 240,
      previewWidthPx: 320,
      treeCollapsed: false,
      previewCollapsed: false
    },
    viewLayout: 1,
    paneTabIds: [],
    focusedPaneIndex: 0,
    paneSplitCols: 0.5,
    paneSplitRows: 0.5,
    listingsByTabId: {},
    listing: { path: '', entries: [], loading: false, error: null, offline: false },
    selectionAnchor: null,
    focusedPath: null,
    renamingPath: null,
    renameSource: null,
    treeFocusPath: null,
    clipboard: null,
    dragPaths: [],
    dropHighlightPath: null,
    dialog: null,
    imageViewer: null,
    imageEditor: null,
    mediaHold: false,
    contextMenu: null,
    search: {
      active: false,
      query: '',
      running: false,
      indexedOnly: false,
      results: [],
      partial: false,
      source: null,
      contentSlow: false,
      progress: null
    },
    recycleBin: {
      active: false,
      loading: false,
      items: [],
      truncated: false
    },
    indexRoots: [],
    indexProgress: {},
    fileOp: null,
    videoThumbRev: 0,
    notice: null,
    addressEditing: false,
    treeMutation: { rev: 0, removed: [], reloadParents: [] },
    treeRefreshRev: 0,
    undoStack: [],
    redoStack: [],

    activeTab() {
      const s = get()
      return s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0]!
    },

    canUndo() {
      return get().undoStack.length > 0
    },

    canRedo() {
      return get().redoStack.length > 0
    },

    undoLabel() {
      const top = get().undoStack[get().undoStack.length - 1]
      return top ? undoActionTitle(top) : null
    },

    redoLabel() {
      const top = get().redoStack[get().redoStack.length - 1]
      return top ? redoActionTitle(top) : null
    },

    async undo() {
      if (historyBusy) return
      const stack = get().undoStack
      const entry = stack[stack.length - 1]
      if (!entry) return
      historyBusy = true
      set({ undoStack: stack.slice(0, -1) })
      try {
        await applyHistoryEntry(entry, 'undo')
        set((s) => ({ redoStack: pushCapped(s.redoStack, entry) }))
        get().notify(undoActionTitle(entry))
      } catch (e) {
        // Put the entry back if undo failed.
        set((s) => ({ undoStack: pushCapped(s.undoStack, entry) }))
        reportOperationError('Undo failed', e)
      } finally {
        historyBusy = false
      }
    },

    async redo() {
      if (historyBusy) return
      const stack = get().redoStack
      const entry = stack[stack.length - 1]
      if (!entry) return
      historyBusy = true
      set({ redoStack: stack.slice(0, -1) })
      try {
        await applyHistoryEntry(entry, 'redo')
        set((s) => ({ undoStack: pushCapped(s.undoStack, entry) }))
        get().notify(redoActionTitle(entry))
      } catch (e) {
        set((s) => ({ redoStack: pushCapped(s.redoStack, entry) }))
        reportOperationError('Redo failed', e)
      } finally {
        historyBusy = false
      }
    },

    async boot() {
      const knownSpecs: { id: KnownFolderId; label: string }[] = [
        { id: 'desktop', label: 'Desktop' },
        { id: 'downloads', label: 'Downloads' },
        { id: 'documents', label: 'Documents' },
        { id: 'pictures', label: 'Pictures' },
        { id: 'music', label: 'Music' },
        { id: 'videos', label: 'Videos' },
        { id: 'home', label: 'User folder' }
      ]
      const [settings, session, home, drivesRes, ...knownPathResults] = await Promise.all([
        call(api.settings.get()),
        call(api.session.get()),
        call(api.app.getPath({ name: 'home' })),
        call(api.fs.listDrives()),
        ...knownSpecs.map((k) =>
          call(api.app.getPath({ name: k.id })).catch(() => ({ path: '' as string }))
        )
      ])
      const knownFolders: KnownFolder[] = []
      for (let i = 0; i < knownSpecs.length; i++) {
        const spec = knownSpecs[i]!
        const p = knownPathResults[i]?.path
        if (!p) continue
        try {
          if ((await call(api.fs.exists({ path: p }))).exists) {
            knownFolders.push({ id: spec.id, label: spec.label, path: p })
          }
        } catch {
          // skip missing known folders
        }
      }

      // Keep session tabs even when a drive is unmounted (encrypted volumes after reboot).
      // loadListing will show Offline and poll until the path is reachable again.
      let tabs = session.tabs.map(sessionTabToTab)

      const defaultPath = settings.defaultNewTabPath || home.path
      if (tabs.length === 0) {
        tabs = [
          {
            id: newTabId(),
            path: defaultPath,
            title: null,
            icon: null,
            viewMode: 'largeIcons',
            sort: { key: 'name', dir: 'asc' },
            back: [],
            forward: [],
            selected: [],
            scrollOffset: 0,
            rootPath: null,
            treeExpanded: []
          }
        ]
      }
      const activeTabId = tabs.find((t) => t.id === session.activeTabId)?.id ?? tabs[0]!.id
      const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]!
      const focus = focusFromSelection(activeTab.selected)

      const splitters =
        session.tabs.length === 0
          ? { ...session.splitters, previewCollapsed: !settings.previewVisibleDefault }
          : session.splitters

      const viewLayout: ViewLayout =
        session.viewLayout === 2 || session.viewLayout === 4 ? session.viewLayout : 1
      const tabIds = tabs.map((t) => t.id)
      let paneTabIds = fillPaneSlots(
        viewLayout,
        session.paneTabIds?.length ? session.paneTabIds : [activeTabId],
        tabIds,
        activeTabId
      )
      let focusedPaneIndex = Math.min(
        viewLayout - 1,
        Math.max(0, session.focusedPaneIndex ?? 0)
      )
      if (paneTabIds[focusedPaneIndex] !== activeTabId) {
        const idx = paneTabIds.indexOf(activeTabId)
        if (idx >= 0) focusedPaneIndex = idx
        else {
          paneTabIds = [...paneTabIds]
          paneTabIds[focusedPaneIndex] = activeTabId
          // dedupe
          for (let i = 0; i < paneTabIds.length; i++) {
            if (i !== focusedPaneIndex && paneTabIds[i] === activeTabId) paneTabIds[i] = null
          }
          paneTabIds = fillPaneSlots(viewLayout, paneTabIds, tabIds, activeTabId)
        }
      }

      set((state) => ({
        booted: true,
        settings,
        homePath: home.path,
        knownFolders,
        drives: drivesRes.drives,
        tabs,
        activeTabId,
        splitters,
        viewLayout,
        paneTabIds,
        focusedPaneIndex,
        paneSplitCols: clampPaneRatio(session.paneSplitCols ?? 0.5),
        paneSplitRows: clampPaneRatio(session.paneSplitRows ?? 0.5),
        listingsByTabId: {},
        selectionAnchor: focus.selectionAnchor,
        focusedPath: focus.focusedPath,
        search: {
          ...state.search,
          indexedOnly: settings.searchIndexedOnly
        }
      }))

      api.onEvent((event: MfeEvent) => {
        const s = get()
        if (event.type === 'fs-changed') {
          const changed = event.payload.path
          // Soft-reload any visible pane whose folder matches.
          const paneTabs = s.tabs.filter((t) => s.paneTabIds.includes(t.id))
          let matchedListing = false
          for (const tab of paneTabs) {
            if (samePath(changed, tab.path)) {
              scheduleSoftReload(tab.path)
              matchedListing = true
            }
          }
          const active = s.activeTab()
          const parent = parentOf(active.path)
          if (!matchedListing && samePath(changed, active.path)) {
            scheduleSoftReload(active.path)
          } else if (parent && samePath(changed, parent)) {
            void (async () => {
              try {
                const ex = await call(api.fs.exists({ path: active.path }))
                if (!ex.exists) {
                  await get().navigate(parent, { push: false })
                  return
                }
              } catch {
                /* ignore */
              }
            })()
            notifyTreeReload([changed])
          } else if (!matchedListing) {
            notifyTreeReload([changed])
          } else {
            notifyTreeReload([changed])
          }
        } else if (event.type === 'search-progress') {
          if (s.search.running) {
            set({
              search: {
                ...get().search,
                progress:
                  event.payload.phase === 'done' ? null : `Scanned ${event.payload.current ?? 0}…`
              }
            })
          }
        } else if (event.type === 'index-progress') {
          set((state) => ({
            indexProgress: {
              ...state.indexProgress,
              [event.payload.rootPath]: event.payload.processed
            }
          }))
          if (event.payload.done) void get().refreshIndexRoots()
        } else if (event.type === 'op-progress') {
          const p = event.payload
          if (p.phase === 'done') {
            set((state) =>
              state.fileOp?.opId === p.opId ? { fileOp: null } : {}
            )
          } else {
            set({
              fileOp: {
                opId: p.opId,
                kind: p.kind,
                done: p.done,
                total: p.total,
                current: p.current,
                label: p.label,
                bytesDone: p.bytesDone,
                bytesTotal: p.bytesTotal
              }
            })
          }
        } else if (event.type === 'external-open') {
          void get().openExternalTarget(event.payload.path, event.payload.reveal)
        }
      })

      void get().refreshIndexRoots()
      startDrivePoll()
      await loadVisiblePaneListings()
      // Flush any CLI/protocol opens that arrived before boot finished.
      void call(api.app.ready())
    },

    async openExternalTarget(targetPath, reveal) {
      try {
        const st = await call(api.fs.stat({ path: targetPath }))
        if (!st.exists) {
          get().notify(`Path not found: ${targetPath}`, true)
          return
        }
        const isDir = st.kind === 'dir'
        const folder = isDir ? targetPath : (parentOf(targetPath) ?? targetPath)
        const selectFile = !isDir && reveal ? targetPath : null

        // Reuse an unscoped tab already on that folder when possible.
        const existing = get().tabs.find((t) => !t.rootPath && samePath(t.path, folder))
        if (existing) {
          await get().activateTab(existing.id)
        } else {
          await get().newTab(folder)
        }
        if (selectFile) {
          get().setSelection([selectFile], selectFile, selectFile)
        }
        get().notify(
          selectFile
            ? `Revealed ${basename(selectFile)}`
            : `Opened ${basename(folder)}`
        )
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    notify(text, isError = false) {
      set({ notice: { text, isError } })
      if (noticeTimer) clearTimeout(noticeTimer)
      noticeTimer = setTimeout(() => set({ notice: null }), isError ? 6000 : 3000)
    },

    async navigate(path, opts) {
      const push = opts?.push ?? true
      const s = get()
      const tabId = opts?.tabId ?? s.activeTabId
      const tab = s.tabs.find((t) => t.id === tabId) ?? s.activeTab()
      const old = tab.path
      if (tab.rootPath && !isUnderPath(path, tab.rootPath)) {
        get().notify(`This tab is limited to ${basename(tab.rootPath)} — open a new tab to leave`)
        return
      }
      if (tabId === s.activeTabId) {
        if (get().search.active) get().clearSearch()
        if (get().recycleBin.active) get().closeRecycleBinView()
      }
      flushPendingRename()
      if (push && !samePath(old, path)) {
        updateTab(tabId, {
          path,
          back: [...tab.back, old],
          forward: [],
          selected: [],
          scrollOffset: 0
        })
      } else {
        updateTab(tabId, { path, selected: [] })
      }
      if (tabId === get().activeTabId) {
        set({
          selectionAnchor: null,
          focusedPath: null,
          renamingPath: null,
          renameSource: null,
          addressEditing: false
        })
      }
      if (!samePath(old, path)) {
        void api.fs.unwatch({ path: old })
        const oldParent = parentOf(old)
        const newParent = parentOf(path)
        if (
          oldParent &&
          !samePath(oldParent, path) &&
          !(newParent && samePath(oldParent, newParent))
        ) {
          void api.fs.unwatch({ path: oldParent })
        }
      }
      await loadListing(path, { tabId })
    },

    async goBack() {
      const tab = get().activeTab()
      const prev = tab.back[tab.back.length - 1]
      if (!prev) return
      updateActiveTab({
        path: prev,
        back: tab.back.slice(0, -1),
        forward: [tab.path, ...tab.forward],
        selected: []
      })
      await loadListing(prev, { tabId: tab.id })
    },

    async goForward() {
      const tab = get().activeTab()
      const next = tab.forward[0]
      if (!next) return
      updateActiveTab({
        path: next,
        back: [...tab.back, tab.path],
        forward: tab.forward.slice(1),
        selected: []
      })
      await loadListing(next, { tabId: tab.id })
    },

    async goUp() {
      const tab = get().activeTab()
      const parent = parentOf(tab.path)
      if (!parent) return
      if (tab.rootPath && !isUnderPath(parent, tab.rootPath)) return
      await get().navigate(parent)
    },

    async refresh() {
      if (get().recycleBin.active) {
        await get().refreshRecycleBinView()
        return
      }
      const tab = get().activeTab()
      const path = tab.path
      // If this folder was renamed/removed externally, land on the parent instead.
      try {
        const ex = await call(api.fs.exists({ path }))
        if (!ex.exists) {
          const parent = parentOf(path)
          if (parent) {
            await get().navigate(parent, { push: false })
            set((s) => ({ treeRefreshRev: s.treeRefreshRev + 1 }))
            return
          }
        }
      } catch {
        /* loadListing will surface the error */
      }
      try {
        const d = await call(api.fs.listDrives())
        set({ drives: d.drives })
      } catch {
        /* ignore */
      }
      await loadVisiblePaneListings({ preserveSelection: true })
      // File list and tree keep separate caches — always refresh both.
      set((s) => ({ treeRefreshRev: s.treeRefreshRev + 1 }))
    },

    setAddressEditing(v) {
      set({ addressEditing: v })
    },

    clearHistory(tabId) {
      const id = tabId ?? get().activeTabId
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab) return
      if (tab.back.length === 0 && tab.forward.length === 0) return
      updateTab(id, { back: [], forward: [] })
    },

    async newTab(path, rootPath) {
      const s = get()
      const target = path ?? s.activeTab().path ?? s.settings.defaultNewTabPath ?? s.homePath
      const tab: Tab = {
        id: newTabId(),
        path: target,
        title: null,
        icon: null,
        viewMode: s.activeTab().viewMode,
        sort: { key: 'name', dir: 'asc' },
        back: [],
        forward: [],
        selected: [],
        scrollOffset: 0,
        rootPath: rootPath ?? null,
        treeExpanded: []
      }
      const focusIdx = s.focusedPaneIndex
      const paneTabIds = s.paneTabIds.map((id, i) => (i === focusIdx ? tab.id : id === tab.id ? null : id))
      // Ensure new tab is in focused pane
      const nextPanes = [...paneTabIds]
      while (nextPanes.length < s.viewLayout) nextPanes.push(null)
      nextPanes[focusIdx] = tab.id
      for (let i = 0; i < nextPanes.length; i++) {
        if (i !== focusIdx && nextPanes[i] === tab.id) nextPanes[i] = null
      }
      set({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        paneTabIds: nextPanes.slice(0, s.viewLayout),
        focusedPaneIndex: focusIdx,
        selectionAnchor: null,
        focusedPath: null
      })
      scheduleSessionSave()
      await loadListing(target, { tabId: tab.id })
    },

    async duplicateTab(id) {
      const s = get()
      const src = s.tabs.find((t) => t.id === id)
      if (!src) return
      const tab: Tab = {
        id: newTabId(),
        path: src.path,
        title: src.title,
        icon: src.icon,
        viewMode: src.viewMode,
        sort: { ...src.sort },
        back: [],
        forward: [],
        selected: [],
        scrollOffset: 0,
        rootPath: src.rootPath,
        treeExpanded: [...src.treeExpanded]
      }
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = [...s.tabs]
      tabs.splice(idx + 1, 0, tab)
      const focusIdx = s.focusedPaneIndex
      const nextPanes = [...s.paneTabIds]
      while (nextPanes.length < s.viewLayout) nextPanes.push(null)
      nextPanes[focusIdx] = tab.id
      for (let i = 0; i < nextPanes.length; i++) {
        if (i !== focusIdx && nextPanes[i] === tab.id) nextPanes[i] = null
      }
      set({
        tabs,
        activeTabId: tab.id,
        paneTabIds: nextPanes.slice(0, s.viewLayout),
        focusedPaneIndex: focusIdx,
        selectionAnchor: null,
        focusedPath: null
      })
      scheduleSessionSave()
      await loadListing(tab.path, { tabId: tab.id })
    },

    async closeTab(id) {
      const s = get()
      if (s.tabs.length <= 1) return
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      const tabIds = tabs.map((t) => t.id)
      let paneTabIds = s.paneTabIds.map((pid) => (pid === id ? null : pid))
      let activeTabId = s.activeTabId
      let focusedPaneIndex = s.focusedPaneIndex
      if (id === s.activeTabId) {
        const nextIdx = Math.min(idx, tabs.length - 1)
        activeTabId = tabs[nextIdx]!.id
        const paneIdx = paneTabIds.indexOf(activeTabId)
        if (paneIdx >= 0) focusedPaneIndex = paneIdx
        else {
          paneTabIds = [...paneTabIds]
          paneTabIds[focusedPaneIndex] = activeTabId
        }
      }
      paneTabIds = fillPaneSlots(s.viewLayout, paneTabIds, tabIds, activeTabId)
      const focus = focusFromSelection(tabs.find((t) => t.id === activeTabId)?.selected ?? [])
      const listingsByTabId = { ...s.listingsByTabId }
      delete listingsByTabId[id]
      set({
        tabs,
        activeTabId,
        paneTabIds,
        focusedPaneIndex,
        listingsByTabId,
        listing: syncActiveListing(listingsByTabId, activeTabId),
        selectionAnchor: focus.selectionAnchor,
        focusedPath: focus.focusedPath
      })
      scheduleSessionSave()
      await loadVisiblePaneListings({ preserveSelection: true })
    },

    async activateTab(id) {
      if (get().search.active) get().clearSearch()
      if (get().recycleBin.active) get().closeRecycleBinView()
      flushPendingRename()
      const s = get()
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab) return
      const existingPane = s.paneTabIds.indexOf(id)
      if (existingPane >= 0) {
        if (s.activeTabId === id && s.focusedPaneIndex === existingPane) return
        const focus = focusFromSelection(tab.selected)
        const listing = s.listingsByTabId[id]
        set({
          activeTabId: id,
          focusedPaneIndex: existingPane,
          selectionAnchor: focus.selectionAnchor,
          focusedPath: focus.focusedPath,
          renamingPath: null,
          renameSource: null,
          listing: listing && samePath(listing.path, tab.path) ? listing : s.listing
        })
        scheduleSessionSave()
        if (!listing || !samePath(listing.path, tab.path)) {
          await loadListing(tab.path, { tabId: id })
        }
        return
      }
      // Not in a pane — assign into focused slot (replace).
      await get().assignTabToPane(s.focusedPaneIndex, id)
    },

    listingForTab(tabId) {
      return get().listingsByTabId[tabId] ?? emptyListing()
    },

    async setViewLayout(mode) {
      const s = get()
      if (mode === s.viewLayout) return
      const tabIds = s.tabs.map((t) => t.id)
      const { paneTabIds, focusedPaneIndex } = remapPanesOnLayoutChange(
        mode,
        s.paneTabIds,
        s.focusedPaneIndex,
        tabIds
      )
      const activeTabId = paneTabIds[focusedPaneIndex] ?? s.activeTabId
      const tab = s.tabs.find((t) => t.id === activeTabId)
      const focus = focusFromSelection(tab?.selected ?? [])
      set({
        viewLayout: mode,
        paneTabIds,
        focusedPaneIndex,
        activeTabId: activeTabId || s.activeTabId,
        selectionAnchor: focus.selectionAnchor,
        focusedPath: focus.focusedPath,
        listing: syncActiveListing(s.listingsByTabId, activeTabId || s.activeTabId)
      })
      scheduleSessionSave()
      await loadVisiblePaneListings({ preserveSelection: true })
    },

    focusPane(index) {
      const s = get()
      if (index < 0 || index >= s.viewLayout) return
      const tabId = s.paneTabIds[index]
      if (!tabId) {
        set({ focusedPaneIndex: index })
        scheduleSessionSave()
        return
      }
      if (s.focusedPaneIndex === index && s.activeTabId === tabId) return
      if (s.search.active && s.activeTabId !== tabId) get().clearSearch()
      if (s.recycleBin.active && s.activeTabId !== tabId) get().closeRecycleBinView()
      const tab = s.tabs.find((t) => t.id === tabId)
      if (!tab) return
      const focus = focusFromSelection(tab.selected)
      const listing = s.listingsByTabId[tabId]
      set({
        focusedPaneIndex: index,
        activeTabId: tabId,
        selectionAnchor: focus.selectionAnchor,
        focusedPath: focus.focusedPath,
        listing: listing ?? s.listing
      })
      scheduleSessionSave()
      if (!listing || !samePath(listing.path, tab.path)) {
        void loadListing(tab.path, { tabId })
      }
    },

    async assignTabToPane(paneIndex, tabId) {
      const s = get()
      if (paneIndex < 0 || paneIndex >= s.viewLayout) return
      let paneTabIds = s.paneTabIds.map((id, i) => {
        if (i === paneIndex) return tabId
        if (tabId && id === tabId) return null
        return id
      })
      while (paneTabIds.length < s.viewLayout) paneTabIds.push(null)
      paneTabIds = paneTabIds.slice(0, s.viewLayout)
      if (!tabId) {
        set({ paneTabIds, focusedPaneIndex: paneIndex })
        scheduleSessionSave()
        return
      }
      const tab = s.tabs.find((t) => t.id === tabId)
      if (!tab) return
      if (s.search.active) get().clearSearch()
      if (s.recycleBin.active) get().closeRecycleBinView()
      const focus = focusFromSelection(tab.selected)
      set({
        paneTabIds,
        focusedPaneIndex: paneIndex,
        activeTabId: tabId,
        selectionAnchor: focus.selectionAnchor,
        focusedPath: focus.focusedPath,
        renamingPath: null,
        renameSource: null
      })
      scheduleSessionSave()
      await loadListing(tab.path, { tabId })
    },

    setPaneSplitCols(ratio) {
      set({ paneSplitCols: clampPaneRatio(ratio) })
      scheduleSessionSave()
    },

    setPaneSplitRows(ratio) {
      set({ paneSplitRows: clampPaneRatio(ratio) })
      scheduleSessionSave()
    },

    setTreeExpanded(paths, tabId) {
      const id = tabId ?? get().activeTabId
      const capped =
        paths.length > MAX_TREE_EXPANDED ? paths.slice(paths.length - MAX_TREE_EXPANDED) : paths
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab) return
      if (sameExpandedSet(tab.treeExpanded, capped)) return
      updateTab(id, { treeExpanded: capped })
    },

    async nextTab() {
      const s = get()
      const idx = s.tabs.findIndex((t) => t.id === s.activeTabId)
      const next = s.tabs[(idx + 1) % s.tabs.length]
      if (next) await get().activateTab(next.id)
    },

    renameTab(id, title) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) }))
      scheduleSessionSave()
    },

    setTabIcon(id, icon) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, icon } : t)) }))
      scheduleSessionSave()
    },

    reorderTab(fromIndex, toIndex) {
      set((s) => {
        const tabs = [...s.tabs]
        const [moved] = tabs.splice(fromIndex, 1)
        if (!moved) return {}
        tabs.splice(toIndex, 0, moved)
        return { tabs }
      })
      scheduleSessionSave()
    },

    owningFolderView(path) {
      const s = get()
      const p = path ?? s.activeTab().path
      return resolveFolderView(p, s.settings.folderViews)
    },

    setViewMode(mode, tabId) {
      const s = get()
      const id = tabId ?? s.activeTabId
      const tab = s.tabs.find((t) => t.id === id) ?? s.activeTab()
      const owning = resolveFolderView(tab.path, s.settings.folderViews)
      if (owning) {
        void get().applySettingsPatch({
          folderViews: patchFolderView(s.settings.folderViews, owning.path, { viewMode: mode })
        })
        return
      }
      updateTab(id, { viewMode: mode })
    },

    setSort(sort, tabId) {
      const s = get()
      const id = tabId ?? s.activeTabId
      const tab = s.tabs.find((t) => t.id === id) ?? s.activeTab()
      const owning = resolveFolderView(tab.path, s.settings.folderViews)
      if (owning) {
        void get().applySettingsPatch({
          folderViews: patchFolderView(s.settings.folderViews, owning.path, { sort })
        })
      } else {
        updateTab(id, { sort })
      }
      // Keep listing in view order so FileView can skip a 20k re-sort on paint.
      if (id === s.activeTabId) viewOrderCache = null
      const listing = s.listingsByTabId[id] ?? (id === s.activeTabId ? s.listing : null)
      if (
        listing &&
        listing.entries.length > 0 &&
        !(id === s.activeTabId && (s.search.active || s.recycleBin.active))
      ) {
        const sorted = sortEntries(listing.entries, sort, s.settings.foldersFirst)
        set((st) => {
          const nextListing = { ...listing, entries: sorted }
          const listingsByTabId = { ...st.listingsByTabId, [id]: nextListing }
          return {
            listingsByTabId,
            listing: id === st.activeTabId ? nextListing : st.listing
          }
        })
      }
    },

    async customizeFolderView(path, recursive) {
      const s = get()
      const tab = s.activeTab()
      const existing = resolveFolderView(path, s.settings.folderViews)
      const entry: FolderView = {
        path,
        recursive,
        viewMode: existing?.viewMode ?? tab.viewMode,
        sort: existing?.sort ?? tab.sort,
        detailsColumns: existing?.detailsColumns ?? s.settings.detailsColumns,
        detailsNameWidth: existing?.detailsNameWidth ?? s.settings.detailsNameWidth
      }
      await get().applySettingsPatch({
        folderViews: upsertFolderView(s.settings.folderViews, entry)
      })
      get().notify(
        recursive
          ? `Customized view for ${basename(path)} and subfolders`
          : `Customized view for ${basename(path)}`
      )
    },

    async removeFolderCustomization(path) {
      const s = get()
      if (!findExactFolderView(path, s.settings.folderViews)) return
      await get().applySettingsPatch({
        folderViews: removeFolderView(s.settings.folderViews, path)
      })
      get().notify(`Removed folder customization: ${basename(path)}`)
    },

    async setFolderViewRecursive(path, recursive) {
      const s = get()
      if (!findExactFolderView(path, s.settings.folderViews)) return
      await get().applySettingsPatch({
        folderViews: patchFolderView(s.settings.folderViews, path, { recursive })
      })
    },

    async patchDetailsLayout(patch) {
      const s = get()
      // Never persist search-only Folder column into global / per-folder layouts.
      const clean =
        patch.detailsColumns != null
          ? {
              ...patch,
              detailsColumns: patch.detailsColumns.filter((c) => c.id !== 'folder')
            }
          : patch
      const owning = resolveFolderView(s.activeTab().path, s.settings.folderViews)
      if (owning) {
        await get().applySettingsPatch({
          folderViews: patchFolderView(s.settings.folderViews, owning.path, clean)
        })
        return
      }
      await get().applySettingsPatch(clean)
    },

    async saveLayout(name) {
      const s = get()
      try {
        const activeIdx = Math.max(
          0,
          s.tabs.findIndex((t) => t.id === s.activeTabId)
        )
        const layout = buildLayoutFromSnapshot(name, {
          tabs: s.tabs,
          activeTabIndex: activeIdx,
          splitters: s.splitters,
          viewLayout: s.viewLayout,
          paneTabIds: s.paneTabIds,
          tabIds: s.tabs.map((t) => t.id),
          paneSplitCols: s.paneSplitCols,
          paneSplitRows: s.paneSplitRows
        })
        await get().applySettingsPatch({
          layouts: upsertLayout(s.settings.layouts, layout)
        })
        get().notify(`Saved layout “${layout.name}”`)
        return layout
      } catch (e) {
        get().notify(e instanceof Error ? e.message : String(e), true)
        return null
      }
    },

    async updateLayout(id) {
      const s = get()
      const existing = s.settings.layouts.find((l) => l.id === id)
      if (!existing) {
        get().notify('Layout not found', true)
        return
      }
      try {
        const activeIdx = Math.max(
          0,
          s.tabs.findIndex((t) => t.id === s.activeTabId)
        )
        const layout = buildLayoutFromSnapshot(
          existing.name,
          {
            tabs: s.tabs,
            activeTabIndex: activeIdx,
            splitters: s.splitters,
            viewLayout: s.viewLayout,
            paneTabIds: s.paneTabIds,
            tabIds: s.tabs.map((t) => t.id),
            paneSplitCols: s.paneSplitCols,
            paneSplitRows: s.paneSplitRows
          },
          existing.id
        )
        await get().applySettingsPatch({
          layouts: upsertLayout(s.settings.layouts, layout)
        })
        get().notify(`Updated layout “${layout.name}”`)
      } catch (e) {
        get().notify(e instanceof Error ? e.message : String(e), true)
      }
    },

    async renameLayout(id, name) {
      const s = get()
      const next = renameLayoutInList(s.settings.layouts, id, name)
      if (!next) {
        get().notify('Enter a layout name', true)
        return
      }
      await get().applySettingsPatch({ layouts: next })
      const renamed = next.find((l) => l.id === id)
      if (renamed) get().notify(`Renamed layout “${renamed.name}”`)
    },

    async removeLayout(id) {
      const s = get()
      const existing = s.settings.layouts.find((l) => l.id === id)
      if (!existing) return
      await get().applySettingsPatch({
        layouts: removeLayoutFromList(s.settings.layouts, id)
      })
      get().notify(`Removed layout “${existing.name}”`)
    },

    async applyLayout(id) {
      const s = get()
      const layout = s.settings.layouts.find((l) => l.id === id)
      if (!layout || layout.tabs.length === 0) {
        get().notify('Layout not found', true)
        return
      }
      const tabs: Tab[] = layout.tabs.map((t) => ({
        id: newTabId(),
        path: t.path,
        title: t.title,
        icon: t.icon ?? null,
        viewMode: t.viewMode,
        sort: t.sort,
        rootPath: t.rootPath,
        treeExpanded: t.treeExpanded,
        back: [],
        forward: [],
        selected: [],
        scrollOffset: 0
      }))
      const idx = Math.min(Math.max(0, layout.activeTabIndex), tabs.length - 1)
      const active = tabs[idx]!
      const viewLayout: ViewLayout =
        layout.viewLayout === 2 || layout.viewLayout === 4 ? layout.viewLayout : 1
      const indexes = layout.paneTabIndexes ?? []
      let paneTabIds: (string | null)[] = Array.from({ length: viewLayout }, (_, i) => {
        const ti = indexes[i]
        return typeof ti === 'number' && ti >= 0 && ti < tabs.length ? tabs[ti]!.id : null
      })
      paneTabIds = fillPaneSlots(
        viewLayout,
        paneTabIds,
        tabs.map((t) => t.id),
        active.id
      )
      let focusedPaneIndex = paneTabIds.indexOf(active.id)
      if (focusedPaneIndex < 0) focusedPaneIndex = 0
      get().clearSearch()
      get().closeRecycleBinView()
      flushPendingRename()
      set({
        tabs,
        activeTabId: active.id,
        splitters: { ...layout.splitters },
        viewLayout,
        paneTabIds,
        focusedPaneIndex,
        paneSplitCols: clampPaneRatio(layout.paneSplitCols ?? 0.5),
        paneSplitRows: clampPaneRatio(layout.paneSplitRows ?? 0.5),
        listingsByTabId: {},
        listing: emptyListing(),
        selectionAnchor: null,
        focusedPath: null,
        renamingPath: null,
        renameSource: null,
        treeFocusPath: null,
        dialog: null,
        contextMenu: null
      })
      scheduleSessionSave()
      await loadVisiblePaneListings()
      get().notify(`Applied layout “${layout.name}”`)
    },

    setScrollOffset(offset, tabId) {
      const id = tabId ?? get().activeTabId
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab) return
      // Scroll fires every frame — skip no-op writes so FileView/TabBar don't re-render.
      if (Math.abs(tab.scrollOffset - offset) < 1) return
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, scrollOffset: offset } : t))
      }))
    },

    setSplitters(patch) {
      set((s) => ({ splitters: { ...s.splitters, ...patch } }))
      scheduleSessionSave()
    },

    setSelection(paths, anchor, focused, tabId) {
      const id = tabId ?? get().activeTabId
      updateTab(id, { selected: paths })
      if (id === get().activeTabId) {
        set({
          selectionAnchor: anchor === undefined ? get().selectionAnchor : anchor,
          focusedPath: focused === undefined ? get().focusedPath : focused
        })
      }
    },

    selectAll(tabId) {
      const s = get()
      const id = tabId ?? s.activeTabId
      const pool =
        s.recycleBin.active && id === s.activeTabId
          ? recycleBinItemsToEntries(s.recycleBin.items)
          : s.search.active && id === s.activeTabId
            ? searchResultsToEntries(s.search.results)
            : (s.listingsByTabId[id]?.entries ?? [])
      const selected = pool
        .filter(
          (e) =>
            !isExcludedByViewFilter(e, s.settings.viewFilterPatterns, s.settings.viewFilterEnabled)
        )
        .map((e) => e.path)
      updateTab(id, { selected })
      if (id === s.activeTabId) {
        set({
          selectionAnchor: selected[0] ?? null,
          focusedPath: selected[selected.length - 1] ?? null
        })
      }
    },

    startRename(path, source = 'files') {
      set({
        renamingPath: path,
        renameSource: source,
        ...(source === 'tree' ? { treeFocusPath: path } : {})
      })
    },

    cancelRename() {
      set({ renamingPath: null, renameSource: null })
    },

    setTreeFocusPath(path) {
      set({ treeFocusPath: path })
    },

    async submitRename(newName) {
      const path = get().renamingPath
      if (!path) return
      set({ renamingPath: null, renameSource: null })

      // Drive roots: edit the volume label only (path stays `C:\`).
      if (isVolumeRootPath(path)) {
        const name = newName.trim()
        const prev =
          get().drives.find((d) => samePath(d.path, path))?.volumeName ?? ''
        if (name === prev) return
        try {
          await withBusyFeedback('relocate', 'Renaming…', name || 'volume', () =>
            call(api.fs.setVolumeLabel({ path, name }))
          )
          const d = await call(api.fs.listDrives())
          set({ drives: d.drives })
          get().notify(
            name && !/^new volume$/i.test(name)
              ? `Renamed volume to “${name}”`
              : 'Cleared volume name'
          )
        } catch (e) {
          get().notify(e instanceof Error ? e.message : 'Could not rename volume', true)
        }
        return
      }

      if (!newName.trim()) return
      const oldName = basename(path)
      if (newName === oldName) return
      try {
        await releaseMediaLocks()
        const res = await withBusyFeedback('relocate', 'Renaming…', newName.trim(), () =>
          call(api.fs.rename({ path, newName: newName.trim() }))
        )
        recordUndo({
          kind: 'rename',
          from: path,
          to: res.path,
          label: oldName
        })
        const parent = parentOf(path)
        notifyTreeMutation({
          removed: [path],
          reloadParents: parent ? [parent] : []
        })
        // If any tab was on this path (or under it), rewrite to the new location.
        const rewrite = (p: string): string => {
          if (samePath(p, path)) return res.path
          if (isUnderPath(p, path)) return res.path + p.slice(path.length)
          return p
        }
        set((s) => ({
          mediaHold: false,
          tabs: s.tabs.map((t) => ({
            ...t,
            path: rewrite(t.path),
            rootPath: t.rootPath ? rewrite(t.rootPath) : null,
            back: t.back.map(rewrite),
            forward: t.forward.map(rewrite),
            selected: t.selected.map(rewrite),
            treeExpanded: t.treeExpanded.map(rewrite)
          }))
        }))
        await get().refresh()
        get().setSelection([res.path], res.path, res.path)
      } catch (e) {
        set({ mediaHold: false })
        reportOperationError('Rename failed', e)
      }
    },

    async createFolder(parent) {
      const dir = parent ?? get().activeTab().path
      try {
        // If creating inside another folder while viewing elsewhere, open it first.
        if (!samePath(dir, get().activeTab().path)) await get().navigate(dir)
        const name = await uniqueChildName(dir, 'New folder', '')
        const res = await call(api.fs.mkdir({ parent: dir, name }))
        recordUndo({ kind: 'create', paths: [res.path], label: name })
        notifyTreeReload([dir])
        await get().refresh()
        get().setSelection([res.path], res.path, res.path)
        get().startRename(res.path)
      } catch (e) {
        reportOperationError('New folder failed', e)
      }
    },

    async createNewFile(parent, name) {
      try {
        if (!samePath(parent, get().activeTab().path)) await get().navigate(parent)
        const res = await call(api.fs.createFile({ parent, name }))
        recordUndo({ kind: 'create', paths: [res.path], label: name })
        await get().refresh()
        get().setSelection([res.path], res.path, res.path)
        set({ dialog: null })
        get().startRename(res.path)
      } catch (e) {
        reportOperationError('New file failed', e)
      }
    },

    async createTypedFile(parent, stem, ext) {
      const suffix = ext.startsWith('.') || ext === '' ? ext : `.${ext}`
      try {
        if (!samePath(parent, get().activeTab().path)) await get().navigate(parent)
        const name = await uniqueChildName(parent, stem, suffix)
        const res = await call(api.fs.createFile({ parent, name }))
        recordUndo({ kind: 'create', paths: [res.path], label: name })
        await get().refresh()
        get().setSelection([res.path], res.path, res.path)
        get().startRename(res.path)
      } catch (e) {
        reportOperationError('New file failed', e)
      }
    },

    copySelection(paths) {
      const selected = paths ?? get().activeTab().selected
      if (selected.length === 0) return
      set({ clipboard: { mode: 'copy', paths: selected } })
      void api.shell.clipboardWriteFiles({ paths: selected })
      get().notify(`Copied ${selected.length} item${selected.length > 1 ? 's' : ''}`)
    },

    cutSelection(paths) {
      const selected = paths ?? get().activeTab().selected
      if (selected.length === 0) return
      set({ clipboard: { mode: 'cut', paths: selected } })
      void api.shell.clipboardWriteFiles({ paths: selected })
      get().notify(`Cut ${selected.length} item${selected.length > 1 ? 's' : ''}`)
    },

    async paste() {
      const clip = await resolveClipboard(get)
      if (!clip || clip.paths.length === 0) return
      const dest = get().activeTab().path
      await get().performTransfer(
        clip.mode === 'cut' ? 'move' : 'copy',
        clip.paths,
        dest,
        clip.mode === 'cut'
      )
    },

    async performTransfer(op, sources, destinationDir, clearCutAfter = false) {
      // Moving into the same folder is a no-op.
      const effective =
        op === 'move'
          ? sources.filter((p) => !samePath(parentOf(p) ?? '', destinationDir))
          : sources
      if (effective.length === 0) return
      try {
        const { conflicts, items } = await call(
          api.fs.checkConflicts({ sources: effective, destinationDir })
        )
        if (conflicts.length > 0) {
          set({
            dialog: {
              kind: 'conflict',
              op,
              sources: effective,
              destinationDir,
              conflicts,
              items,
              clearCutAfter
            }
          })
          return
        }
        await executeTransfer(op, effective, destinationDir, 'fail', clearCutAfter)
      } catch (e) {
        reportOperationError(op === 'move' ? 'Move failed' : 'Copy failed', e)
      }
    },

    async createShortcutsHere(sources, destinationDir) {
      if (sources.length === 0) return
      const label =
        sources.length === 1 ? basename(sources[0]!) : `${sources.length} items`
      try {
        const res = await withBusyFeedback(
          'relocate',
          'Creating shortcuts…',
          label,
          () => call(api.fs.createShortcuts({ sources, destinationDir }))
        )
        recordUndo({
          kind: 'create',
          paths: res.created,
          label:
            res.created.length === 1
              ? basename(res.created[0]!)
              : `${res.created.length} shortcuts`
        })
        // Refresh every visible pane — dest may be a non-focused view.
        await get().refresh()
        get().notify(
          res.created.length === 1
            ? 'Created shortcut'
            : `Created ${res.created.length} shortcuts`
        )
      } catch (e) {
        reportOperationError('Create shortcut failed', e)
      }
    },

    async compressToZip(paths) {
      const selected =
        paths && paths.length > 0 ? paths : get().activeTab().selected
      if (selected.length === 0) return
      const label =
        selected.length === 1 ? basename(selected[0]!) : `${selected.length} items`
      try {
        const res = await withBusyFeedback('zip', 'Compressing…', label, () =>
          call(api.fs.compressToZip({ paths: selected }))
        )
        recordUndo({
          kind: 'create',
          paths: [res.zipPath],
          label: basename(res.zipPath)
        })
        const parent = parentOf(res.zipPath)
        if (parent && samePath(parent, get().activeTab().path)) {
          await get().refresh()
          get().setSelection([res.zipPath], res.zipPath, res.zipPath)
        }
        get().notify(`Created ${basename(res.zipPath)}`)
      } catch (e) {
        reportOperationError('Compress failed', e)
      }
    },

    async extractZip(paths) {
      const selected =
        paths && paths.length > 0 ? paths : get().activeTab().selected
      if (selected.length === 0) return
      const label =
        selected.length === 1 ? basename(selected[0]!) : `${selected.length} archives`
      try {
        const res = await withBusyFeedback('zip', 'Extracting…', label, () =>
          call(api.fs.extractZip({ paths: selected }))
        )
        if (res.extractedDirs.length === 0) return
        recordUndo({
          kind: 'create',
          paths: res.extractedDirs,
          label:
            res.extractedDirs.length === 1
              ? basename(res.extractedDirs[0]!)
              : `${res.extractedDirs.length} folders`
        })
        const parent = parentOf(res.extractedDirs[0]!)
        if (parent && samePath(parent, get().activeTab().path)) {
          await get().refresh()
          const focus = res.extractedDirs[0]!
          get().setSelection(res.extractedDirs, focus, focus)
        }
        get().notify(
          res.extractedDirs.length === 1
            ? `Extracted to ${basename(res.extractedDirs[0]!)}`
            : `Extracted ${res.extractedDirs.length} archives`
        )
      } catch (e) {
        reportOperationError('Extract failed', e)
      }
    },

    async resolveConflict(choice) {
      const dialog = get().dialog
      set({ dialog: null })
      if (!dialog || dialog.kind !== 'conflict' || choice === null) return

      const conflictNames = new Set(dialog.conflicts.map((n) => n.toLowerCase()))
      const decisionFor = (name: string): ConflictDecision | null => {
        if (typeof choice === 'string') return choice
        const hit = choice[name] ?? choice[name.toLowerCase()]
        return hit ?? null
      }

      const replaceSources = dialog.sources.filter((s) => {
        const name = basename(s)
        if (!conflictNames.has(name.toLowerCase())) return true
        return decisionFor(name) === 'replace'
      })
      const renameSources = dialog.sources.filter((s) => {
        const name = basename(s)
        if (!conflictNames.has(name.toLowerCase())) return false
        return decisionFor(name) === 'rename'
      })
      const skippedConflicts = dialog.conflicts.filter((n) => decisionFor(n) === 'skip').length

      try {
        let copied = 0
        let moved = 0
        let skipped = skippedConflicts
        const copyPaths: string[] = []
        const movePairs: { from: string; to: string }[] = []
        const busyLabel = dialog.op === 'copy' ? 'Copying…' : 'Moving…'
        const busyCurrent =
          dialog.sources.length === 1
            ? basename(dialog.sources[0]!)
            : `${dialog.sources.length} items`

        await withBusyFeedback(dialog.op, busyLabel, busyCurrent, async () => {
          if (replaceSources.length > 0) {
            const r = await runTransfer(
              dialog.op,
              replaceSources,
              dialog.destinationDir,
              'replace'
            )
            copied += r.copied
            moved += r.moved
            skipped += r.skipped
            copyPaths.push(...r.copyPaths)
            movePairs.push(...r.movePairs)
          }
          if (renameSources.length > 0) {
            const r = await runTransfer(
              dialog.op,
              renameSources,
              dialog.destinationDir,
              'rename'
            )
            copied += r.copied
            moved += r.moved
            skipped += r.skipped
            copyPaths.push(...r.copyPaths)
            movePairs.push(...r.movePairs)
          }
        })

        if (dialog.op === 'copy') {
          if (copyPaths.length > 0) {
            recordUndo({
              kind: 'copy',
              paths: copyPaths,
              label: basename(copyPaths[0]!)
            })
          }
          get().notify(`Copied ${copied}, skipped ${skipped}`)
          notifyTreeReload([dialog.destinationDir])
        } else {
          if (movePairs.length > 0) {
            recordUndo({
              kind: 'move',
              pairs: movePairs,
              label: basename(movePairs[0]!.to)
            })
          }
          get().notify(`Moved ${moved}, skipped ${skipped}`)
          if (dialog.clearCutAfter) set({ clipboard: null })
          notifyTreeMutation({
            removed: [...replaceSources, ...renameSources],
            reloadParents: [dialog.destinationDir]
          })
        }
        await get().refresh()
      } catch (e) {
        reportOperationError(dialog.op === 'move' ? 'Move failed' : 'Copy failed', e)
      }
    },

    async deleteSelection(permanent, paths) {
      const s = get()
      if (s.recycleBin.active) {
        // In the bin: Del / Shift+Del permanently remove from the Recycle Bin.
        get().deleteFromRecycleBinView(paths)
        return
      }
      const target = paths ?? s.activeTab().selected
      if (target.length === 0) return
      if (!permanent) {
        try {
          // Select the survivor first so the preview keeps painting while we trash.
          selectAfterDelete(target)
          await releaseMediaLocks()
          await withBusyFeedback(
            'trash',
            'Moving to Recycle Bin…',
            target.length === 1 ? basename(target[0]!) : `${target.length} items`,
            () => call(api.fs.trash({ paths: target }))
          )
          recordUndo({
            kind: 'trash',
            paths: [...target],
            label: basename(target[0]!)
          })
          get().notify(`Moved ${target.length} item${target.length > 1 ? 's' : ''} to Recycle Bin`)
          await afterPathsRemoved(target)
        } catch (e) {
          clearMediaHold()
          reportOperationError('Delete failed', e)
        }
        return
      }
      // Paths deleted from the tree may not appear in the current listing.
      const anyDir = target.some((p) => {
        const e = s.listing.entries.find((en) => samePath(en.path, p))
        return e ? e.kind === 'dir' : true
      })
      const needsConfirm = target.length > 1 || anyDir || s.settings.confirmPermanentDeleteAlways
      if (needsConfirm) {
        set({ dialog: { kind: 'confirm-permanent-delete', paths: target } })
      } else {
        await doPermanentDelete(target)
      }

      async function doPermanentDelete(toDelete: string[]): Promise<void> {
        try {
          selectAfterDelete(toDelete)
          await releaseMediaLocks()
          await withBusyFeedback(
            'delete',
            'Deleting…',
            toDelete.length === 1 ? basename(toDelete[0]!) : `${toDelete.length} items`,
            () => call(api.fs.deletePermanent({ paths: toDelete }))
          )
          get().notify(`Permanently deleted ${toDelete.length} item${toDelete.length > 1 ? 's' : ''}`)
          await afterPathsRemoved(toDelete)
        } catch (e) {
          clearMediaHold()
          reportOperationError('Delete failed', e)
        }
      }
    },

    async confirmPermanentDelete(confirmed) {
      const dialog = get().dialog
      set({ dialog: null })
      if (!dialog || dialog.kind !== 'confirm-permanent-delete' || !confirmed) return
      try {
        selectAfterDelete(dialog.paths)
        await releaseMediaLocks()
        await withBusyFeedback(
          'delete',
          'Deleting…',
          dialog.paths.length === 1 ? basename(dialog.paths[0]!) : `${dialog.paths.length} items`,
          () => call(api.fs.deletePermanent({ paths: dialog.paths }))
        )
        get().notify(
          `Permanently deleted ${dialog.paths.length} item${dialog.paths.length > 1 ? 's' : ''}`
        )
        await afterPathsRemoved(dialog.paths)
      } catch (e) {
        clearMediaHold()
        reportOperationError('Delete failed', e)
      }
    },

    async openEntry(entry) {
      if (entry.kind === 'dir') {
        await get().navigate(entry.path)
        return
      }
      if (isImageExt(entry.ext)) {
        get().openImageViewer(
          entry.path,
          get().search.active
            ? get()
                .search.results.filter((r) => {
                  if (r.isDir) return false
                  const d = r.name.lastIndexOf('.')
                  const ext = d > 0 ? r.name.slice(d + 1).toLowerCase() : ''
                  return isImageExt(ext)
                })
                .map((r) => r.path)
            : undefined
        )
        return
      }
      await get().openPath(entry.path)
    },

    async openPath(path) {
      try {
        const res = await call(api.shell.openPath({ path }))
        if (!res.opened) get().notify(res.message ?? 'Could not open file', true)
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async openFileLocation(filePath) {
      let isDir = false
      try {
        const st = await call(api.fs.stat({ path: filePath }))
        isDir = st.kind === 'dir'
      } catch {
        // fall through — treat as file if under a parent
      }
      if (get().search.active) get().clearSearch()
      if (get().recycleBin.active) get().closeRecycleBinView()
      if (isDir) {
        await get().navigate(filePath)
        return
      }
      const parent = parentOf(filePath)
      if (!parent) {
        get().notify('No parent folder', true)
        return
      }
      await get().navigate(parent)
      get().setSelection([filePath], filePath, filePath)
    },

    async openFileInNewTab(filePath) {
      let isDir = false
      try {
        const st = await call(api.fs.stat({ path: filePath }))
        isDir = st.kind === 'dir'
      } catch {
        /* treat as file */
      }
      if (get().search.active) get().clearSearch()
      if (get().recycleBin.active) get().closeRecycleBinView()
      if (isDir) {
        await get().newTab(filePath)
        return
      }
      const parent = parentOf(filePath)
      if (!parent) {
        get().notify('No parent folder', true)
        return
      }
      await get().newTab(parent)
      get().setSelection([filePath], filePath, filePath)
    },

    openImageViewer(path, siblings) {
      const listingSiblings = get()
        .listing.entries.filter((e) => e.kind === 'file' && isImageExt(e.ext))
        .map((e) => e.path)
      const list =
        siblings && siblings.length > 0
          ? siblings
          : listingSiblings.some((p) => samePath(p, path))
            ? listingSiblings
            : [path]
      const current = list.find((p) => samePath(p, path)) ?? path
      set({ imageViewer: { path: current, siblings: list }, contextMenu: null })
    },

    closeImageViewer() {
      set({ imageViewer: null })
    },

    openImageEditor(path, mediaUrl) {
      set({
        imageEditor: { path, mediaUrl },
        imageViewer: null,
        contextMenu: null
      })
    },

    closeImageEditor() {
      set({ imageEditor: null })
    },

    async saveEditedImage(path, dataBase64) {
      await releaseMediaLocks()
      try {
        await call(api.fs.saveEditedImage({ path, dataBase64 }))
        get().notify('Image saved')
        set({ imageEditor: null })
        await get().refresh()
        set({ mediaHold: false })
      } catch (e) {
        set({ mediaHold: false })
        get().notify(e instanceof IpcError ? e.message : String(e), true)
        throw e
      }
    },

    async saveEditedImageAs(sourcePath, dataBase64) {
      const base = basename(sourcePath)
      const dot = base.lastIndexOf('.')
      const stem = dot > 0 ? base.slice(0, dot) : base
      const ext = dot > 0 ? base.slice(dot) : '.jpg'
      const parent = parentOf(sourcePath) ?? sourcePath
      const defaultPath = joinPath(parent, `${stem}_edited${ext}`)
      try {
        const res = await call(
          api.fs.saveEditedImageAs({ dataBase64, defaultPath })
        )
        if (res.cancelled || !res.path) return null
        get().notify(`Saved as ${basename(res.path)}`)
        await get().refresh()
        return res.path
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
        throw e
      }
    },

    async revertImageOriginal(path) {
      await releaseMediaLocks()
      try {
        await call(api.fs.revertImageOriginal({ path }))
        get().notify('Reverted to original')
        await get().refresh()
        set({ mediaHold: false })
      } catch (e) {
        set({ mediaHold: false })
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    imageViewerNavigate(delta) {
      const v = get().imageViewer
      if (!v || v.siblings.length === 0) return
      const idx = v.siblings.findIndex((p) => samePath(p, v.path))
      const base = idx >= 0 ? idx : 0
      let nextIdx: number
      if (delta === 'first') nextIdx = 0
      else if (delta === 'last') nextIdx = v.siblings.length - 1
      else nextIdx = (base + delta + v.siblings.length) % v.siblings.length
      const path = v.siblings[nextIdx]
      if (path) set({ imageViewer: { ...v, path } })
    },

    async imageViewerDelete(permanent) {
      const v = get().imageViewer
      if (!v) return
      updateActiveTab({ selected: [v.path] })
      await get().deleteSelection(permanent)
    },

    async showInExplorer(path) {
      try {
        await call(api.shell.showItemInFolder({ path }))
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async copyPathsToClipboard(paths, nameOnly) {
      const text = paths.map((p) => (nameOnly ? basename(p) : p)).join('\r\n')
      await navigator.clipboard.writeText(text)
      get().notify(nameOnly ? 'Name copied' : 'Path copied')
    },

    setDragPaths(paths) {
      set({
        dragPaths: paths,
        ...(paths.length === 0 ? { dropHighlightPath: null } : {})
      })
    },

    setDropHighlight(path) {
      set((s) => (s.dropHighlightPath === path ? {} : { dropHighlightPath: path }))
    },

    openDialog(dialog) {
      set({ dialog })
    },

    closeDialog() {
      set({ dialog: null })
    },

    openContextMenu(menu) {
      set({ contextMenu: menu })
    },

    closeContextMenu() {
      set({ contextMenu: null })
    },

    async applySettingsPatch(patch) {
      const prev = get().settings
      // Optimistic update so toggles don’t snap back while IPC runs.
      set((s) => ({
        settings: { ...s.settings, ...patch },
        ...(typeof patch.searchIndexedOnly === 'boolean'
          ? { search: { ...s.search, indexedOnly: patch.searchIndexedOnly } }
          : {})
      }))
      try {
        const settings = await call(api.settings.set(patch))
        set((s) => ({
          settings,
          ...(typeof patch.searchIndexedOnly === 'boolean'
            ? { search: { ...s.search, indexedOnly: settings.searchIndexedOnly } }
            : {})
        }))
      } catch (e) {
        set({ settings: prev })
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    quickAccessEntries() {
      const s = get()
      const tokens = materializeQuickAccessTokens(
        s.settings.quickAccess,
        s.settings.quickAccessPins,
        s.settings.quickAccessHiddenDefaults
      )
      return buildQuickAccess(s.knownFolders, tokens)
    },

    async pinQuickAccess(path) {
      try {
        const st = await call(api.fs.stat({ path }))
        if (!st.exists || st.kind !== 'dir') {
          get().notify('Only folders can be pinned to Quick access', true)
          return
        }
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
        return
      }
      const s = get()
      const entries = s.quickAccessEntries()
      if (entries.some((e) => samePath(e.path, path))) {
        get().notify('Already in Quick access')
        return
      }
      const tokens = materializeQuickAccessTokens(
        s.settings.quickAccess,
        s.settings.quickAccessPins,
        s.settings.quickAccessHiddenDefaults
      )
      const token = tokenForPath(path, s.knownFolders)
      await get().applySettingsPatch({
        quickAccess: [...tokens, token],
        quickAccessPins: [],
        quickAccessHiddenDefaults: []
      })
      const label =
        s.knownFolders.find((k) => samePath(k.path, path))?.label ?? basename(path)
      get().notify(`Pinned to Quick access: ${label}`)
    },

    async unpinQuickAccess(path) {
      const s = get()
      const entries = s.quickAccessEntries()
      const entry = entries.find((e) => samePath(e.path, path))
      if (!entry) return
      const tokens = materializeQuickAccessTokens(
        s.settings.quickAccess,
        s.settings.quickAccessPins,
        s.settings.quickAccessHiddenDefaults
      ).filter((t) => t.toLowerCase() !== entry.token.toLowerCase())
      await get().applySettingsPatch({
        quickAccess: tokens,
        quickAccessPins: [],
        quickAccessHiddenDefaults: []
      })
      get().notify(`Removed from Quick access: ${entry.label}`)
    },

    async reorderQuickAccess(fromIndex, toIndex) {
      const s = get()
      const tokens = materializeQuickAccessTokens(
        s.settings.quickAccess,
        s.settings.quickAccessPins,
        s.settings.quickAccessHiddenDefaults
      )
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= tokens.length ||
        toIndex >= tokens.length ||
        fromIndex === toIndex
      ) {
        return
      }
      const next = [...tokens]
      const [moved] = next.splice(fromIndex, 1)
      if (!moved) return
      next.splice(toIndex, 0, moved)
      await get().applySettingsPatch({
        quickAccess: next,
        quickAccessPins: [],
        quickAccessHiddenDefaults: []
      })
    },

    async resetQuickAccess() {
      await get().applySettingsPatch({
        quickAccess: [],
        quickAccessPins: [],
        quickAccessHiddenDefaults: []
      })
      get().notify('Quick access restored to defaults')
    },

    async addViewFilterPatterns(patterns) {
      const s = get()
      const existing = new Set(s.settings.viewFilterPatterns.map((p) => p.toLowerCase()))
      const added = patterns.filter((p) => p.trim() && !existing.has(p.toLowerCase()))
      if (added.length === 0 && s.settings.viewFilterEnabled) {
        get().notify('Already in view filter')
        return
      }
      await get().applySettingsPatch({
        viewFilterEnabled: true,
        viewFilterPatterns: [...s.settings.viewFilterPatterns, ...added]
      })
      get().notify(
        added.length === 1
          ? `Hidden from view: ${added[0]} — manage in Settings`
          : `Hidden from view (${added.length} patterns) — manage in Settings`
      )
    },

    async clearThumbCache() {
      try {
        await call(api.settings.clearThumbCache())
        get().notify('Thumbnail cache cleared')
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async generateVideoThumbs(paths, mode, opts) {
      if (paths.length === 0) return
      try {
        const res = await withBusyFeedback(
          'vid-thumbs',
          'Video previews…',
          paths.length === 1 ? basename(paths[0]!) : `${paths.length} items`,
          () =>
            call(
              api.thumbs.generateVidCache({
                paths,
                mode,
                recursive: opts?.recursive ?? false
              })
            )
        )
        set((s) => ({ videoThumbRev: s.videoThumbRev + 1 }))
        const failN = res.failed.length
        if (res.generated === 0 && failN === 0 && res.skipped > 0) {
          get().notify(
            res.skipped === 1
              ? 'Video preview already exists'
              : `All ${res.skipped} video previews already exist`
          )
        } else if (failN > 0) {
          get().notify(
            `Video previews: ${res.generated} generated, ${res.skipped} skipped, ${failN} failed`,
            true
          )
        } else {
          get().notify(
            res.generated === 1
              ? 'Generated video preview'
              : `Generated ${res.generated} video previews${res.skipped > 0 ? ` (${res.skipped} skipped)` : ''}`
          )
        }
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    setSearchQuery(q) {
      set((s) => ({ search: { ...s.search, query: q } }))
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
      const trimmed = q.trim()
      if (!trimmed) {
        if (get().search.active) get().clearSearch()
        return
      }
      searchDebounceTimer = setTimeout(() => {
        searchDebounceTimer = null
        void get().runSearch()
      }, SEARCH_DEBOUNCE_MS)
    },

    setSearchIndexedOnly(v) {
      set((s) => ({ search: { ...s.search, indexedOnly: v } }))
      void get().applySettingsPatch({ searchIndexedOnly: v })
      // Re-run with the new scope when a search session is already open
      // (indexed = all ready roots; unchecked = current folder).
      const s = get()
      if (s.search.active && s.search.query.trim()) {
        void get().runSearch()
      }
    },

    async runSearch() {
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer)
        searchDebounceTimer = null
      }
      const s = get()
      const query = s.search.query.trim()
      if (!query) return
      if (s.recycleBin.active) get().closeRecycleBinView()
      // Drop any in-flight walk/query before starting a new scope.
      void api.search.cancel()
      const seq = ++searchSeq
      // Use live toggle state (settings patch may still be in flight).
      const indexedOnly = get().search.indexedOnly
      const settings = get().settings
      // Details view — Folder column is injected by FileView for search only (not saved).
      get().setViewMode('details')
      set({
        search: {
          ...get().search,
          indexedOnly,
          active: true,
          running: true,
          results: [],
          partial: false,
          source: null,
          contentSlow: false,
          progress: null
        }
      })
      updateActiveTab({ selected: [] })
      set({ selectionAnchor: null, focusedPath: null })
      try {
        const res = await call(
          api.search.query({
            query,
            // indexed → every ready indexed root; otherwise current folder (+ index as accelerator).
            scope: indexedOnly
              ? { type: 'indexed' }
              : {
                  type: 'folder',
                  path: get().activeTab().path,
                  recursive: true,
                  useIndexIfCovered: true
                },
            limit: 2000,
            offset: 0,
            matchPath: settings.searchMatchPath,
            matchCase: settings.searchMatchCase,
            wholeWord: settings.searchWholeWord,
            regex: settings.searchRegex
          })
        )
        if (seq !== searchSeq) return
        set((state) => ({
          search: {
            ...state.search,
            running: false,
            results: res.items,
            partial: res.partial,
            source: res.source,
            contentSlow: Boolean(res.contentSlow),
            progress: null
          }
        }))
      } catch (e) {
        if (seq !== searchSeq) return
        set((state) => ({ search: { ...state.search, running: false, progress: null } }))
        if (!(e instanceof IpcError && e.code === 'cancelled')) {
          get().notify(e instanceof IpcError ? e.message : String(e), true)
        }
      }
    },

    clearSearch() {
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer)
        searchDebounceTimer = null
      }
      searchSeq++
      void api.search.cancel()
      set((s) => ({
        search: {
          ...s.search,
          active: false,
          running: false,
          results: [],
          partial: false,
          source: null,
          contentSlow: false,
          progress: null,
          query: ''
        }
      }))
      // Folder sort only exists during search — drop it when leaving.
      const sort = get().activeTab().sort
      if (sort.key === 'folder') get().setSort({ key: 'name', dir: sort.dir })
    },

    async openRecycleBinView() {
      get().clearSearch()
      set({
        recycleBin: { active: true, loading: true, items: [], truncated: false }
      })
      updateActiveTab({ selected: [] })
      set({ selectionAnchor: null, focusedPath: null })
      try {
        const res = await call(api.fs.listRecycleBin())
        set({
          recycleBin: {
            active: true,
            loading: false,
            items: res.items,
            truncated: Boolean(res.truncated)
          }
        })
      } catch (e) {
        set({
          recycleBin: { active: true, loading: false, items: [], truncated: false }
        })
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    closeRecycleBinView() {
      set({
        recycleBin: { active: false, loading: false, items: [], truncated: false }
      })
    },

    async refreshRecycleBinView() {
      if (!get().recycleBin.active) return
      set((s) => ({ recycleBin: { ...s.recycleBin, loading: true } }))
      try {
        const res = await call(api.fs.listRecycleBin())
        set({
          recycleBin: {
            active: true,
            loading: false,
            items: res.items,
            truncated: Boolean(res.truncated)
          }
        })
      } catch (e) {
        set((s) => ({ recycleBin: { ...s.recycleBin, loading: false } }))
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async restoreFromRecycleBinView(paths) {
      const s = get()
      const target = paths ?? s.activeTab().selected
      if (target.length === 0) return
      try {
        const res = await withBusyFeedback(
          'trash',
          'Restoring…',
          target.length === 1 ? basename(target[0]!) : `${target.length} items`,
          () => call(api.fs.restoreFromTrash({ paths: target }))
        )
        const msg =
          res.missing.length > 0
            ? `Restored ${res.restored.length}; ${res.missing.length} not found in Recycle Bin`
            : `Restored ${res.restored.length} item${res.restored.length === 1 ? '' : 's'}`
        get().notify(msg, res.missing.length > 0)
        await get().refreshRecycleBinView()
        updateActiveTab({ selected: [] })
        set({ selectionAnchor: null, focusedPath: null })
        if (res.restored.length > 0) {
          notifyTreeReload(parentsOfPaths(res.restored))
        }
      } catch (e) {
        reportOperationError('Restore failed', e)
      }
    },

    emptyRecycleBinView() {
      set({ dialog: { kind: 'confirm-empty-recycle-bin' } })
    },

    async confirmEmptyRecycleBin(confirmed) {
      set({ dialog: null })
      if (!confirmed) return
      try {
        await withBusyFeedback('trash', 'Emptying Recycle Bin…', undefined, () =>
          call(api.fs.emptyRecycleBin())
        )
        get().notify('Recycle Bin emptied')
        await get().refreshRecycleBinView()
        updateActiveTab({ selected: [] })
        set({ selectionAnchor: null, focusedPath: null })
      } catch (e) {
        reportOperationError('Empty Recycle Bin failed', e)
      }
    },

    deleteFromRecycleBinView(paths) {
      const s = get()
      const target = paths ?? s.activeTab().selected
      if (target.length === 0) return
      const anyDir = target.some((p) => {
        const it = s.recycleBin.items.find((i) => samePath(i.originalPath, p))
        return it?.isDir ?? true
      })
      const needsConfirm = target.length > 1 || anyDir || s.settings.confirmPermanentDeleteAlways
      if (needsConfirm) {
        set({ dialog: { kind: 'confirm-delete-from-recycle-bin', paths: target } })
        return
      }
      set({ dialog: { kind: 'confirm-delete-from-recycle-bin', paths: target } })
      void get().confirmDeleteFromRecycleBin(true)
    },

    async confirmDeleteFromRecycleBin(confirmed) {
      const dialog = get().dialog
      const paths =
        dialog && dialog.kind === 'confirm-delete-from-recycle-bin' ? dialog.paths : null
      set({ dialog: null })
      if (!confirmed || !paths || paths.length === 0) return
      try {
        const res = await withBusyFeedback(
          'delete',
          'Deleting from Recycle Bin…',
          paths.length === 1 ? basename(paths[0]!) : `${paths.length} items`,
          () => call(api.fs.deleteFromRecycleBin({ paths }))
        )
        get().notify(
          res.missing.length > 0
            ? `Deleted ${res.deleted.length}; ${res.missing.length} missing`
            : `Permanently deleted ${res.deleted.length} item${res.deleted.length === 1 ? '' : 's'}`
        )
        await get().refreshRecycleBinView()
        updateActiveTab({ selected: [] })
        set({ selectionAnchor: null, focusedPath: null })
      } catch (e) {
        reportOperationError('Delete from Recycle Bin failed', e)
      }
    },

    async addIndexRootAction(path) {
      try {
        const res = await call(api.search.addRoot({ path }))
        set({ indexRoots: res.roots })
        get().notify(`Indexing ${path}…`)
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async addVolumeRootAction(path) {
      try {
        const res = await call(api.search.addVolume({ path }))
        set({ indexRoots: res.roots })
        get().notify(`Indexing drive ${path}…`)
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async removeIndexRootAction(path) {
      try {
        const res = await call(api.search.removeRoot({ path }))
        set({ indexRoots: res.roots })
        get().notify('Removed from search index')
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async reindexAction(path) {
      try {
        await call(api.search.reindex({ rootPath: path }))
        get().notify('Reindexing started')
        await get().refreshIndexRoots()
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async refreshIndexRoots() {
      try {
        const res = await call(api.search.listRoots())
        set({ indexRoots: res.roots })
      } catch {
        // search db unavailable — leave empty
      }
    }
  }
})

/** Sorted entries for the current listing, honoring tab sort + folders-first. */
export function sortEntries(
  entries: DirEntry[],
  sort: SortSpec,
  foldersFirst: boolean
): DirEntry[] {
  const dir = sort.dir === 'asc' ? 1 : -1
  // Shared collator — localeCompare options-object per call is much slower on 10k+ rows.
  const sorted = [...entries].sort((a, b) => {
    if (foldersFirst) {
      const ad = a.kind === 'dir' ? 0 : 1
      const bd = b.kind === 'dir' ? 0 : 1
      if (ad !== bd) return ad - bd
    }
    let cmp = 0
    switch (sort.key) {
      case 'name':
        cmp = nameCollator.compare(a.name, b.name)
        break
      case 'mtime':
        cmp = a.mtimeMs - b.mtimeMs
        break
      case 'ctime':
        cmp = a.birthtimeMs - b.birthtimeMs
        break
      case 'size':
        cmp = a.size - b.size
        break
      case 'type':
      case 'ext':
        cmp = nameCollator.compare(a.ext, b.ext) || nameCollator.compare(a.name, b.name)
        break
      case 'folder': {
        const ap = parentOf(a.path) ?? ''
        const bp = parentOf(b.path) ?? ''
        cmp = nameCollator.compare(ap, bp)
        break
      }
    }
    if (cmp === 0 && sort.key !== 'name') {
      cmp = nameCollator.compare(a.name, b.name)
    }
    return cmp * dir
  })
  return sorted
}

/** Prefer in-app clipboard; otherwise read CF_HDROP from the OS (Explorer → MFE paste). */
async function resolveClipboard(
  get: () => { clipboard: ClipboardState }
): Promise<ClipboardState> {
  const local = get().clipboard
  if (local && local.paths.length > 0) return local
  try {
    const os = await call(api.shell.clipboardReadFiles())
    if (os.paths.length > 0) return { mode: 'copy', paths: os.paths }
  } catch {
    // no OS file clipboard
  }
  return null
}

/** Explorer drag-drop convention: default move on same volume, copy across; Ctrl forces copy, Shift forces move. */
export function dropOperation(
  sourcePath: string,
  destDir: string,
  ctrlKey: boolean,
  shiftKey: boolean
): 'copy' | 'move' {
  if (ctrlKey) return 'copy'
  if (shiftKey) return 'move'
  const sameVolume = driveOf(sourcePath) !== null && driveOf(sourcePath) === driveOf(destDir)
  return sameVolume ? 'move' : 'copy'
}

export function selectionContainsDir(entries: DirEntry[], selected: string[]): boolean {
  return entries.some((e) => e.kind === 'dir' && selected.some((p) => samePath(p, e.path)))
}

export { isUnderPath }
