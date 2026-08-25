import { create } from 'zustand'
import type {
  DirEntry,
  ConflictPolicy,
  ConflictDecision,
  ConflictItem,
  DriveInfo,
  IssueDecision,
  OpIssue
} from '@shared/schemas/fs'
import type {
  SessionState,
  SortSpec,
  TabIcon,
  TabState,
  ViewMode,
  ViewLayout,
  Splitters,
  ClosedTabEntry
} from '@shared/schemas/session'
import { coerceViewLayout, sanitizePaneTreeCollapsed, MAX_CLOSED_TABS } from '@shared/schemas/session'
import { issueKey } from '@shared/opIssues'
import { defaultTabIcon } from '@shared/tabIcons'
import type { HistoryEntry } from '@shared/tabHistory'
import {
  folderHistory,
  historyLocationPath,
  persistHistoryEntry,
  rewriteHistoryEntry,
  searchHistory,
  sameHistoryEntry
} from '@shared/tabHistory'
import { MAX_TREE_EXPANDED } from '@shared/schemas/session'
import { clampPaneRatio, fillPaneSlots, remapPanesOnLayoutChange } from '@shared/viewPanes'
import type { Settings, SettingsPatch } from '@shared/schemas/settings'
import { networkDiscoveryIntervalMs } from '@shared/schemas/settings'
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
import { formatBytes } from '../lib/format'
import { basename, parentOf, samePath, joinPath, driveOf, isUnderPath } from '../lib/paths'
import {
  patchDirEntriesForRename,
  renameDestOccupied,
  renameShouldFollow,
  rewritePathAfterRename
} from '../lib/renameListing'
import { clearFileViewScroll, liveFileViewScroll } from '../lib/fileViewScroll'
import { tabRootDeletePrompt, tabsWhoseRootIsDeleted } from '../lib/tabRootDelete'
import { isRemoteLocation, parseRemoteLocation, remoteBasename } from '@shared/remotePaths'
import { isNetworkHostUnc, parseUnc } from '@shared/networkPaths'
import { ListingLru, driveTypeForPath, isListingCacheEligible } from '@shared/listingCache'
import { expandArgsTemplate } from '@shared/contextMenuCommands'
import { shouldPopStackedDialog, shouldPushDialog } from '@shared/scriptDialogStack'
import { emptySlideshowSession, type SlideshowSession } from '../lib/slideshowTypes'
import {
  createSlideshowActions,
  loadCategorizerMapFromPath,
  hydrateSlideshowCacheFromSettings,
  type SlideshowActions
} from './slideshowActions'
import { registerViewOrderCacheClear } from '../lib/slideshowPlayHeap'
import { isVolumeRootPath } from '../lib/rightDrag'
import {
  buildQuickAccess,
  materializeQuickAccessList,
  materializeQuickAccessTokens,
  tokenForPath,
  type KnownFolder,
  type KnownFolderId,
  type QuickAccessEntry
} from '../lib/quickAccess'
import {
  isQuickAccessGroup,
  removeQuickAccessToken,
  tokenExistsInQuickAccess,
  type QuickAccessItem
} from '@shared/schemas/quickAccess'
import { isMediaApiLimitError } from '@shared/mediaApiLimit'
import { isMediaNameMissError } from '@shared/mediaMetadata'
import { type MediaLibraryItemFlags, type MediaWatchedFilter } from '@shared/mediaMetadata'
import { isExcludedByMediaLibrary, listingFoldersFirst } from '../lib/mediaLibrary'
import { isExcludedByViewFilter, listingHasAllSelected } from '../lib/viewFilter'
import {
  mergeDismissedPaths,
  pruneSearchResultItems,
  searchResultsToEntries
} from '../lib/searchEntries'
import { formatSearchProgress } from '@shared/searchProgress'
import { isIncompleteSearchQuery, isSearchNarrowing, narrowSearchItems } from '@shared/searchQuery'
import { recycleBinItemsToEntries } from '../lib/recycleBinEntries'
import { isImageExt } from '../lib/icons'
import { defaultPasteFormat, type ClipboardPasteFormat } from '@shared/schemas/clipboardPaste'
import { invalidateThumbMemory, invalidateThumbMemoryMany, thumbPathKey } from '../lib/thumbMemory'
import { nextSelectionAfterDelete } from '../lib/nextSelection'
import { dedupeDirEntries } from '@shared/dirEntries'
import {
  pushCapped,
  redoActionTitle,
  undoActionTitle,
  pathsAfterRedo,
  pathsAfterUndo,
  type UndoEntry,
  type UndoPathPair
} from '../lib/undoHistory'

export type SearchState = {
  active: boolean
  query: string
  running: boolean
  indexedOnly: boolean
  results: SearchResultItem[]
  partial: boolean
  source: 'index' | 'walk' | null
  contentSlow: boolean
  progress: string | null
  gen: number
  message: string | null
  /** Deleted/moved during this search — live progress must not put them back. */
  dismissed: string[]
  /** Query the current walk/index is actually scanning. */
  walkQuery: string
  /** Unfiltered hits from that walk — display may narrow these as you type. */
  walkItems: SearchResultItem[]
}

export function emptyTabSearch(indexedOnly = false): SearchState {
  return {
    active: false,
    query: '',
    running: false,
    indexedOnly,
    results: [],
    partial: false,
    source: null,
    contentSlow: false,
    progress: null,
    gen: 0,
    message: null,
    dismissed: [],
    walkQuery: '',
    walkItems: []
  }
}

export type Tab = {
  id: string
  path: string
  title: string | null
  /** Optional Lucide icon (name + color) shown on the tab. */
  icon: TabIcon
  viewMode: ViewMode
  sort: SortSpec
  back: HistoryEntry[]
  forward: HistoryEntry[]
  selected: string[]
  scrollOffset: number
  /** Scoped tab: this folder is the tree root; navigation stays inside it. */
  rootPath: string | null
  /** Expanded folder-tree directories for this tab (persisted in session). */
  treeExpanded: string[]
  /** Search is a location on this tab (WFE). Other tabs keep their own results. */
  search: SearchState
}

function currentLocation(tab: Tab): HistoryEntry {
  if (tab.search.active && tab.search.query.trim()) {
    return searchHistory(tab.search.query.trim(), tab.path, tab.search.indexedOnly)
  }
  return folderHistory(
    tab.path,
    liveFileViewScroll(tab.id) ?? tab.scrollOffset,
    tab.selected[tab.selected.length - 1]
  )
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
  | {
      kind: 'op-issues'
      op: 'copy' | 'move' | 'trash' | 'delete' | 'rename'
      issues: OpIssue[]
      destinationDir?: string
      clearCutAfter?: boolean
      doneCount: number
    }
  | { kind: 'new-file'; parent: string }
  | { kind: 'paste-name'; destDir: string; format: ClipboardPasteFormat }
  | { kind: 'manage-templates' }
  | { kind: 'create-link'; source: string }
  | { kind: 'view-preset-name' }
  | { kind: 'properties'; path: string }
  | { kind: 'usn-manager'; path: string }
  | { kind: 'settings'; section?: string }
  | { kind: 'categorizer-map'; returnSection?: string }
  | { kind: 'compiled-lists-config'; returnSection?: string }
  | { kind: 'ads-manager'; path: string }
  | { kind: 'ads-field-column' }
  | {
      kind: 'layout-name'
      mode: 'save' | 'rename'
      layoutId?: string
      initialName?: string
      /** Re-open Settings on this section after success. */
      returnSection?: string
    }
  | { kind: 'tab-icon'; tabId: string }
  | { kind: 'tab-custom-icon'; tabId: string }
  | { kind: 'item-note'; path: string }
  | { kind: 'item-icon'; path: string }
  | {
      kind: 'alert'
      title: string
      message: string
      detail?: string
      path?: string
      /** Re-run Calculate Statistics (skips folders already tagged). */
      retryFolderStats?: { path: string }
    }
  | {
      kind: 'confirm'
      title: string
      message: string
      confirmLabel?: string
      danger?: boolean
    }
  | { kind: 'power-rename'; paths: string[] }
  | { kind: 'copy-move-to'; op: 'copy' | 'move'; paths: string[] }
  | { kind: 'power-search' }
  | { kind: 'change-cover'; path: string }
  | { kind: 'media-kind'; title: string; message: string }
  | {
      kind: 'media-pick'
      title: string
      message: string
      candidates: { id: string; title: string; year?: number; subtitle?: string }[]
    }
  | {
      kind: 'media-name'
      title: string
      message: string
      fileName: string
      suggested: string
    }
  | { kind: 'script-manager'; selectId?: string }
  | {
      kind: 'script-run'
      scriptId?: string
      source?: string
      language?: import('@shared/schemas/scripts').ScriptLanguage
      name?: string
      mode: import('@shared/schemas/scripts').ScriptRunMode
      root?: string
      paths?: string[]
      recursive?: boolean
      dryRun?: boolean
    }
  | {
      kind: 'script-generate'
      mode?: import('@shared/schemas/scripts').ScriptRunMode
      folderPath?: string
      scriptId?: string
      source?: string
      language?: import('@shared/schemas/scripts').ScriptLanguage
      name?: string
      description?: string
      recursive?: boolean
      reviewFix?: boolean
    }
  | null

export type MediaLibraryState = {
  folderPath: string
  isContainer: boolean
  items: Record<string, MediaLibraryItemFlags>
  watchedFilter: MediaWatchedFilter
  genreFilter: string | null
}

export function emptyMediaLibrary(): MediaLibraryState {
  return {
    folderPath: '',
    isContainer: false,
    items: {},
    watchedFilter: 'all',
    genreFilter: null
  }
}

/** Temporary preview override: `ads: null` = `$DATA` (original); else `VER_k`. */
export type ImageVersionPreview = { path: string; ads: string | null }

/** Staging feedback when opening a remote file with the default app. */
export type RemoteBusyDialog =
  | { status: 'working'; title: string; message: string }
  | { status: 'error'; title: string; message: string; detail: string }

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
  /** Slideshow player menu (categorize / delete / undo / edit / reveal / exit). */
  slideshow?: boolean
  /** Tree section header (Drives / Network) — This PC tools / Map / Disconnect / Refresh. */
  treeSection?: 'drives' | 'network' | 'recycle-bin'
} | null

export type NetworkNeighborhoodState = {
  status: 'idle' | 'running' | 'done' | 'error'
  hosts: { name: string; unc: string }[]
  /** Cached shares keyed by lowercased server name. */
  sharesByHost: Record<
    string,
    {
      status: 'idle' | 'loading' | 'done' | 'error'
      shares: { name: string; unc: string; remark?: string }[]
      message?: string
    }
  >
  generation: number
  message?: string
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
  kind:
    | 'copy'
    | 'move'
    | 'trash'
    | 'delete'
    | 'relocate'
    | 'vid-thumbs'
    | 'folder-stats'
    | 'zip'
    | 'compile-lists'
    | 'media-metadata'
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
/** As-you-type search debounce (D34). Long enough that `.obj` is usually one walk. */
const SEARCH_DEBOUNCE_MS = 500
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

/** Session-only last listing for UNC / mapped / `mfe-remote://` (D49). */
const remoteListingCache = new ListingLru<DirEntry>()
/** Short-lived snapshots used specifically to paint Back/Forward immediately. */
const historyListingCache = new ListingLru<DirEntry>()

function listingCacheOk(path: string, drives: DriveInfo[]): boolean {
  return isListingCacheEligible(path, { driveType: driveTypeForPath(path, drives) })
}

function rememberRemoteListing(path: string, entries: DirEntry[], drives: DriveInfo[]): void {
  if (!listingCacheOk(path, drives)) return
  remoteListingCache.set(path, entries)
}

function dropRemoteListingCaches(paths: Iterable<string>): void {
  for (const p of paths) {
    if (p) remoteListingCache.invalidate(p)
  }
}

/** Soft-reload / watch tiers — full re-lists are expensive; fs.watch itself is cheap. */
const WATCH_FAST_MAX = 1_000
const WATCH_THROTTLED_MAX = 8_000
const SOFT_RELOAD_GAP_FAST_MS = 400
const SOFT_RELOAD_GAP_THROTTLED_MS = 4_000

type WatchArmMode = 'full' | 'parent-only' | 'none'

function watchArmModeForCount(n: number): WatchArmMode {
  if (n >= WATCH_THROTTLED_MAX) return 'parent-only'
  return 'full'
}

function softReloadMinGapMs(n: number): number {
  if (n >= WATCH_THROTTLED_MAX) return Number.POSITIVE_INFINITY
  if (n >= WATCH_FAST_MAX) return SOFT_RELOAD_GAP_THROTTLED_MS
  return SOFT_RELOAD_GAP_FAST_MS
} /**
 * Cached view order for delete-next selection. Rebuilding via localeCompare on
 * 20k rows every Del is a multi-hundred-ms hitch; prune updates this in place.
 */
let viewOrderCache: {
  listingRef: readonly { path: string }[]
  sortKey: string
  sortDir: string
  foldersFirst: boolean
  filterKey: string
  paths: string[]
} | null = null
registerViewOrderCacheClear(() => {
  viewOrderCache = null
})
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
let sessionSaveTimer: ReturnType<typeof setTimeout> | null = null
let noticeTimer: ReturnType<typeof setTimeout> | null = null
let confirmResolve: ((confirmed: boolean) => void) | null = null
let mediaKindResolve: ((choice: 'movie' | 'show' | null) => void) | null = null
export type MediaPickResult = { action: 'pick'; id: string } | { action: 'search-as' }
let mediaPickResolve: ((choice: MediaPickResult | null) => void) | null = null
let mediaNameResolve: ((name: string | null) => void) | null = null

type AppState = {
  booted: boolean
  /** Main-process OS (from app:ready). */
  platform: string
  settings: Settings
  homePath: string
  /** Resolved known folders for Quick access (Desktop, Downloads, …). */
  knownFolders: KnownFolder[]
  drives: DriveInfo[]
  /** Async Network neighborhood (LAN hosts); never blocks listing refresh. */
  network: NetworkNeighborhoodState
  tabs: Tab[]
  activeTabId: string
  /** Last-closed first; persisted in session.json (D55). */
  closedTabs: ClosedTabEntry[]
  splitters: Splitters
  /** Multi-pane layout (D31): 1 | 2 side-by-side | 3 wide-top | 4 (2×2). */
  viewLayout: ViewLayout
  /** Tab id per pane slot; null = empty drop target. Length === viewLayout. */
  paneTabIds: (string | null)[]
  /** Folder tree hidden per pane (length === viewLayout). */
  paneTreeCollapsed: boolean[]
  focusedPaneIndex: number
  paneSplitCols: number
  paneSplitRows: number
  /** Per-tab directory listings for visible panes. */
  listingsByTabId: Record<string, Listing>
  /** Listing for the active (focused) tab — mirrors listingsByTabId[activeTabId]. */
  listing: Listing
  selectionAnchor: string | null
  focusedPath: string | null
  /**
   * When set, the focused pane's FileView scrolls this path into view once it
   * appears in the listing (reveal / open location). Cleared after scroll.
   */
  fileListScrollRequest: { path: string; gen: number } | null
  renamingPath: string | null
  /**
   * Where the inline rename UI should appear. Folders exist in both the tree and
   * file view — only one surface mounts RenameInput so focus isn't stolen.
   */
  renameSource: 'tree' | 'files' | null
  /** Last folder clicked/focused in the tree (for F2 rename). */
  treeFocusPath: string | null
  /** Tree **Drives** header selected — status bar + preview show every volume. */
  drivesOverview: boolean
  clipboard: ClipboardState
  dragPaths: string[]
  /** Global drop-target folder while dragging (multi-pane highlight). */
  dropHighlightPath: string | null
  dialog: DialogState
  /** Previous script dialogs (Manager / Generate / Run) so Close returns to the caller. */
  dialogStack: Exclude<DialogState, null>[]
  scriptLibrary: import('@shared/schemas/scripts').ScriptDefinition[]
  /** In-app full-size image viewer (double-click / Enter on images). */
  imageViewer: { path: string; siblings: string[] } | null
  /** In-app Filerobot image editor (preview Edit button / context menu). */
  imageEditor: { path: string; mediaUrl: string } | null
  /**
   * Temporary preview override for image version streams.
   * `ads: null` = pristine `$DATA`; otherwise e.g. `VER_2`.
   */
  imageVersionPreview: ImageVersionPreview | null
  /**
   * When true, preview/viewer detach AV/PDF media so Windows can delete/rename
   * files Chromium may still hold. Image previews use buffered/scratch mfe-media
   * (D7) and stay painted to avoid a black flash on delete.
   */
  mediaHold: boolean
  /** Detached preview window is open — docked pane must not mount `<video>`/`<audio>`. */
  previewWindowOpen: boolean
  contextMenu: ContextMenuState
  /** Hidden local gate — slideshow and related IPC (main reads DEV.cfg). */
  devGateActive: boolean
  /** userData DEV.cfg exists — Appearance toggle visibility only. */
  devGatePresent: boolean
  /** ENABLE field in DEV.cfg (features still require computer-name match). */
  devGateEnable: boolean
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
  /**
   * Per-file thumb invalidation (ADS tip save). Listing mtime often unchanged.
   */
  thumbRevByPath: Record<string, number>
  /**
   * Bumped after ADS edits so Details column meta refetches for `path`.
   */
  columnMetaBump: { rev: number; path: string | null }
  notice: Notice
  /**
   * Modal while staging a remote file for Open (download → default app),
   * or the resulting error. Connect uses its own local feedback.
   */
  remoteBusyDialog: RemoteBusyDialog | null
  addressEditing: boolean
  /**
   * Bumped after FS mutations so the folder tree can prune removed nodes and/or
   * reload a parent's children (e.g. after mkdir / paste / rename).
   */
  treeMutation: {
    rev: number
    removed: string[]
    reloadParents: string[]
    renamed: { from: string; to: string }[]
  }
  /**
   * Bumped by Refresh (F5) so the folder tree reloads every folder it has already
   * listed — listing alone does not update the tree cache.
   */
  treeRefreshRev: number
  /** Bumped to collapse every expanded tree branch on one tab. */
  treeCollapseRequest: { tabId: string; rev: number }
  /** In-memory Explorer-style undo stack (not persisted). */
  undoStack: UndoEntry[]
  redoStack: UndoEntry[]
  /** Slideshow / categorizer session (gate: settings.slideshowFeaturesEnabled). */
  slideshow: SlideshowSession
  /** Toolbar filters for a folder marked as a media metadata container. */
  mediaLibrary: MediaLibraryState

  // derived helpers
  activeTab(): Tab

  // lifecycle
  boot(): Promise<void>
  /** Write session.json now (new tab / quit) so default icons are not lost. */
  flushSession(): void

  // notices
  notify(text: string, isError?: boolean): void
  clearRemoteBusyDialog(): void
  /**
   * After ADS (or similar) edits: bump so FileView re-fetches column meta for `path`.
   */
  bumpColumnMeta(path: string): void
  /**
   * After media-metadata cover writes: drop in-memory thumbs and force icon
   * tiles + preview to refetch (ADS does not change listing mtime).
   */
  invalidateContentThumbs(paths: string[]): void

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
  /** Jump to a Recent Locations entry (folder or search). */
  goToHistoryEntry(entry: HistoryEntry, tabId?: string): Promise<void>

  /** Start / restart LAN host discovery (async; does not block listings). */
  startNetworkDiscovery(): Promise<void>
  /** Lazy-load shares for `\\server` when expanding in the tree. */
  loadNetworkShares(server: string, opts?: { force?: boolean }): Promise<void>
  /** Open Windows Map Network Drive dialog, then refresh drives. */
  openMapNetworkDrive(): Promise<void>
  /** Open Windows Disconnect Network Drive dialog, then refresh drives. */
  openDisconnectNetworkDrive(): Promise<void>
  /** Disconnect + forget one mapped letter (removes persistent mapping). */
  disconnectMappedDrive(path: string, opts?: { force?: boolean }): Promise<void>
  /** Immediately re-list drive letters (after map/disconnect). */
  refreshDrivesNow(): Promise<void>

  // tabs
  newTab(path?: string, rootPath?: string): Promise<void>
  /** Duplicate a tab (same path/view/title/icon; fresh history/selection). */
  duplicateTab(id: string): Promise<void>
  /** Open/reveal a path from CLI or another app (new or existing tab). */
  openExternalTarget(path: string, reveal: boolean): Promise<void>
  closeTab(id: string): Promise<void>
  /** Restore a closed tab (0 = most recent). No-op when the stack is empty. */
  reopenClosedTab(index?: number): Promise<void>
  /** Drop the closed-tab stack (session persist). */
  clearClosedTabs(): void
  activateTab(id: string): Promise<void>
  nextTab(): Promise<void>
  renameTab(id: string, title: string | null): void
  setTabIcon(id: string, icon: TabIcon): void
  reorderTab(fromIndex: number, toIndex: number): void

  // multi-pane (D31)
  setViewLayout(mode: ViewLayout): Promise<void>
  focusPane(index: number): void
  assignTabToPane(paneIndex: number, tabId: string | null): Promise<void>
  /**
   * Drag-tab onto a pane. Default: assign/move into that pane.
   * With `duplicate` (Ctrl+drag): clone into the pane so the source pane keeps the original.
   */
  duplicateTabIntoPane(
    paneIndex: number,
    sourceTabId: string,
    opts?: { duplicate?: boolean }
  ): Promise<void>
  setPaneSplitCols(ratio: number): void
  setPaneSplitRows(ratio: number): void
  togglePaneTree(paneIndex: number): void
  /** Listing for a tab (pane); falls back to empty. */
  listingForTab(tabId: string): Listing

  // view state
  setViewMode(mode: ViewMode, tabId?: string): void
  setSort(sort: SortSpec, tabId?: string): void
  setScrollOffset(offset: number, tabId?: string): void
  /** Persist folder-tree expansion for a tab (default: active). */
  setTreeExpanded(paths: string[], tabId?: string): void
  /** Collapse every expanded tree branch on the current tab (This PC default). */
  collapseAllTree(): void
  setSplitters(patch: Partial<Splitters>): void
  /** Owning folder-view override for a path (exact or recursive ancestor). */
  owningFolderView(path?: string): FolderView | null
  customizeFolderView(path: string, recursive: boolean): Promise<void>
  removeFolderCustomization(path: string): Promise<void>
  setFolderViewRecursive(path: string, recursive: boolean): Promise<void>
  saveViewPreset(name: string): Promise<void>
  applyViewPreset(id: string): Promise<void>
  renameViewPreset(id: string, name: string): Promise<void>
  removeViewPreset(id: string): Promise<void>
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
  /** Select all visible items, or clear the selection when everything is already selected. */
  toggleSelectAll(tabId?: string): void
  /** True when every visible (non-filtered) item in the tab is selected. */
  isAllSelected(tabId?: string): boolean
  /** Ask the file list to scroll so `path` is visible (after listing is ready). */
  requestFileListScrollTo(path: string): void
  clearFileListScrollRequest(): void

  // fs ops
  startRename(path: string, source?: 'tree' | 'files'): void
  submitRename(newName: string): Promise<void>
  cancelRename(): void
  /**
   * Power Rename Apply: rename each path to `newName` (basename only).
   * Name clashes open the same review as copy/move; other IO errors are skipped.
   */
  applyPowerRename(
    items: { path: string; newName: string }[]
  ): Promise<{ pairs: UndoPathPair[]; skipped: string[] }>
  /** Dialog Undo: relocate pairs back; pop matching power-rename undo if still on top. */
  undoPowerRenameApply(pairs: UndoPathPair[]): Promise<void>
  setTreeFocusPath(path: string | null): void
  /** Select the tree Drives header (all-volumes status + preview pies). */
  showDrivesOverview(): void
  createFolder(parent?: string): Promise<void>
  createNewFile(parent: string, name: string): Promise<void>
  /** Create “New …ext” with a unique name and start inline rename. */
  createTypedFile(parent: string, stem: string, ext: string): Promise<void>
  createFromTemplate(templateId: string, destDir: string): Promise<void>
  importFileTemplate(): Promise<string | null>
  replaceFileTemplate(templateId: string): Promise<void>
  duplicateFileTemplate(templateId: string): Promise<string | null>
  deleteFileTemplate(templateId: string): Promise<void>
  /** Copy paths to in-app + OS file clipboard. Defaults to the file-view selection. */
  copySelection(paths?: string[]): void
  /** Cut paths to in-app + OS file clipboard. Defaults to the file-view selection. */
  cutSelection(paths?: string[]): void
  paste(): Promise<void>
  /** Paste into a specific folder (file transfer or D56 clipboard file). */
  pasteInto(destDir: string): Promise<void>
  pasteClipboardAs(destDir: string, format: ClipboardPasteFormat, name?: string): Promise<void>
  performTransfer(
    op: 'copy' | 'move',
    sources: string[],
    destinationDir: string,
    clearCutAfter?: boolean
  ): Promise<boolean>
  /** Right-drag “Create shortcuts here” — write .lnk files pointing at sources. */
  createShortcutsHere(sources: string[], destinationDir: string): Promise<void>
  createLink(
    source: string,
    destDir: string,
    type: import('@shared/schemas/createLink').CreateLinkType,
    name?: string
  ): Promise<void>
  /** Compress selection (or explicit paths) to a sibling `.zip` like Explorer. */
  compressToZip(paths?: string[]): Promise<void>
  /** Extract selected `.zip` archives into sibling folders (Extract All…). */
  extractZip(paths?: string[]): Promise<void>
  /**
   * Conflict dialog result: cancel, one batch policy for all, or per-name decisions.
   * Non-conflicting sources always transfer.
   */
  resolveConflict(choice: null | ConflictDecision | Record<string, ConflictDecision>): Promise<void>
  /** End-of-op review: apply per-item or skip remaining (null). */
  resolveOpIssues(
    items:
      | null
      | {
          source: string
          dest?: string
          decision: IssueDecision
          sourceMtimeMs?: number
          destMtimeMs?: number
        }[]
  ): Promise<void>
  /** Delete file-view selection, or explicit `paths` (e.g. tree-focused folder). */
  deleteSelection(permanent: boolean, paths?: string[]): Promise<void>
  /** Set a custom folder icon (desktop.ini + Folder.ico). Picks a .ico via dialog. */
  changeFolderIcon(folderPath: string): Promise<void>
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
  /** Save Filerobot output as tip ADS (pristine `$DATA` kept on first save). */
  saveEditedImage(path: string, dataBase64: string): Promise<void>
  /** Save to a new path via dialog — no original backup. */
  saveEditedImageAs(sourcePath: string, dataBase64: string): Promise<string | null>
  revertImageOriginal(path: string): Promise<void>
  dropImageVersion(path: string, ver: number): Promise<void>
  commitImageVersion(path: string): Promise<void>
  setImageVersionPreview(preview: ImageVersionPreview | null): void
  askConfirm(opts: {
    title: string
    message: string
    confirmLabel?: string
    danger?: boolean
  }): Promise<boolean>
  resolveConfirm(confirmed: boolean): void
  askMediaKind(opts: { title: string; message: string }): Promise<'movie' | 'show' | null>
  resolveMediaKind(choice: 'movie' | 'show' | null): void
  askMediaPick(opts: {
    title: string
    message: string
    candidates: { id: string; title: string; year?: number; subtitle?: string }[]
  }): Promise<MediaPickResult | null>
  resolveMediaPick(choice: MediaPickResult | null): void
  askMediaName(opts: {
    title: string
    message: string
    fileName: string
    suggested: string
  }): Promise<string | null>
  resolveMediaName(name: string | null): void
  imageViewerNavigate(delta: number | 'first' | 'last'): void
  /** Delete the image currently shown in the viewer (Del → trash, Shift+Del → permanent). */
  imageViewerDelete(permanent: boolean): Promise<void>
  showInExplorer(path: string): Promise<void>
  /** Open cmd or PowerShell (Settings) with cwd = folder. Pass elevated for UAC (Shift+click). */
  openCommandLineHere(path: string, opts?: { elevated?: boolean }): Promise<void>
  copyPathsToClipboard(paths: string[], nameOnly: boolean): Promise<void>

  // drag & drop
  setDragPaths(paths: string[]): void
  setDropHighlight(path: string | null): void

  // dialogs / menus
  openDialog(dialog: DialogState): void
  closeDialog(): void
  openContextMenu(menu: ContextMenuState): void
  closeContextMenu(): void
  /** Launch a Settings → Context menu external command for the given paths. */
  runContextMenuCommand(commandId: string, paths: string[]): Promise<void>
  runDiscoveredContextMenuVerb(verbId: string, paths: string[]): Promise<void>

  // settings
  applySettingsPatch(patch: SettingsPatch): Promise<void>
  /** Write ENABLE in existing DEV.cfg. No-op if the file is absent. */
  setDevGateEnable(enable: boolean): Promise<void>
  addViewFilterPatterns(patterns: string[]): Promise<void>
  clearThumbCache(): Promise<void>
  /** Portable backup: settings + remembered network hosts (not window geometry). */
  exportSettingsFile(): Promise<void>
  /** Replace settings from an export / settings.json file. */
  importSettingsFile(): Promise<void>
  refreshScriptLibrary(): Promise<void>
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
  /** Count files/folders and attach FileCount / FolderCount ADS streams on a local folder. */
  calculateFolderStatistics(
    folderPath: string,
    opts?: { skipTagged?: boolean; skipOnError?: boolean }
  ): Promise<void>
  mediaMetadataExtractPlex(paths: string[]): Promise<void>
  mediaMetadataDownload(paths: string[]): Promise<void>
  mediaMetadataRefresh(paths: string[]): Promise<void>
  mediaMetadataClear(paths: string[]): Promise<void>
  mediaMetadataConsolidateSubtitles(paths: string[]): Promise<void>
  mediaMetadataSetWatched(paths: string[], watched: boolean): Promise<void>
  setMediaLibraryWatchedFilter(value: MediaWatchedFilter): void
  setMediaLibraryGenreFilter(genre: string | null): void

  // Quick access
  quickAccessEntries(): QuickAccessEntry[]
  pinQuickAccess(path: string, groupId?: string): Promise<void>
  unpinQuickAccess(path: string): Promise<void>
  reorderQuickAccess(fromIndex: number, toIndex: number): Promise<void>
  resetQuickAccess(): Promise<void>
  createQuickAccessGroup(name: string): Promise<void>
  renameQuickAccessGroup(id: string, name: string): Promise<void>
  deleteQuickAccessGroup(id: string): Promise<void>
  setQuickAccessGroupColor(id: string, color: string | undefined): Promise<void>
  setQuickAccessGroupCollapsed(id: string, collapsed: boolean): Promise<void>
  moveQuickAccessPinToGroup(token: string, groupId: string | null): Promise<void>

  // search
  setSearchQuery(q: string): void
  setSearchIndexedOnly(v: boolean): void
  runSearch(tabId?: string): Promise<void>
  clearSearch(tabId?: string): void
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
} & SlideshowActions

function splitBaseExt(name: string): { stem: string; ext: string } {
  const d = name.lastIndexOf('.')
  if (d > 0) return { stem: name.slice(0, d), ext: name.slice(d) }
  return { stem: name, ext: '' }
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
    historyBack: t.back.map(persistHistoryEntry),
    historyForward: t.forward.map(persistHistoryEntry),
    search: {
      active: t.search.active,
      query: t.search.query,
      indexedOnly: t.search.indexedOnly
    },
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
    icon: t.icon ?? defaultTabIcon(t.path, t.rootPath),
    viewMode: t.viewMode,
    sort: t.sort,
    back: t.historyBack,
    forward: t.historyForward,
    selected: t.selectedPaths,
    scrollOffset: t.scrollOffset,
    rootPath: t.rootPath,
    treeExpanded: t.treeExpanded,
    search: {
      ...emptyTabSearch(t.search?.indexedOnly ?? false),
      active: t.search?.active === true && Boolean(t.search.query?.trim()),
      query: t.search?.query ?? '',
      indexedOnly: t.search?.indexedOnly ?? false
    }
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

function poolEntriesForTab(s: AppState, tabId: string): { path: string; isHidden: boolean }[] {
  const tabSearch = s.tabs.find((t) => t.id === tabId)?.search
  if (s.recycleBin.active && tabId === s.activeTabId) {
    return recycleBinItemsToEntries(s.recycleBin.items)
  }
  if (tabSearch?.active) return searchResultsToEntries(tabSearch.results)
  return s.listingsByTabId[tabId]?.entries ?? []
}

function selectablePathsForTab(s: AppState, tabId: string): string[] {
  const listingPath = s.listingsByTabId[tabId]?.path ?? ''
  const searchActive = s.tabs.find((t) => t.id === tabId)?.search.active === true
  const recycleActive = s.recycleBin.active && tabId === s.activeTabId
  const applyMedia =
    !searchActive &&
    !recycleActive &&
    s.mediaLibrary.isContainer &&
    listingPath &&
    samePath(listingPath, s.mediaLibrary.folderPath)
  return poolEntriesForTab(s, tabId)
    .filter((e) => {
      // Recycle Bin shows every item — view filters / $Recycle.Bin patterns do not apply.
      if (
        !recycleActive &&
        isExcludedByViewFilter(e, s.settings.viewFilterPatterns, s.settings.viewFilterEnabled, {
          ignoreHiddenAttr: searchActive
        })
      ) {
        return false
      }
      if (applyMedia && isExcludedByMediaLibrary(e.path, s.mediaLibrary)) return false
      return true
    })
    .map((e) => e.path)
}

function tabHasAllSelected(s: AppState, tabId: string): boolean {
  const selectedCount = s.tabs.find((t) => t.id === tabId)?.selected.length ?? 0
  return listingHasAllSelected(selectedCount, selectablePathsForTab(s, tabId).length)
}

export const useAppStore = create<AppState>()((set, get) => {
  function persistSession(): void {
    const s = get()
    if (!s.booted) return
    const session: SessionState = {
      version: 1,
      activeTabId: s.activeTabId,
      tabs: s.tabs.map(tabToSessionTab),
      splitters: s.splitters,
      viewLayout: s.viewLayout,
      paneTabIds: s.paneTabIds,
      paneTreeCollapsed: s.paneTreeCollapsed,
      focusedPaneIndex: s.focusedPaneIndex,
      paneSplitCols: s.paneSplitCols,
      paneSplitRows: s.paneSplitRows,
      closedTabs: s.closedTabs.slice(0, MAX_CLOSED_TABS)
    }
    void api.session.set(session)
  }

  function scheduleSessionSave(): void {
    if (sessionSaveTimer) clearTimeout(sessionSaveTimer)
    sessionSaveTimer = setTimeout(() => persistSession(), 500)
  }

  function flushSessionSave(): void {
    if (sessionSaveTimer) {
      clearTimeout(sessionSaveTimer)
      sessionSaveTimer = null
    }
    persistSession()
  }

  function syncActiveListing(
    listingsByTabId: Record<string, Listing>,
    activeTabId: string
  ): Listing {
    return listingsByTabId[activeTabId] ?? emptyListing()
  }

  /** Reload listings for every tab currently shown in a pane. */
  async function loadVisiblePaneListings(opts?: {
    preserveSelection?: boolean
    soft?: boolean
    force?: boolean
  }): Promise<void> {
    const s = get()
    const ids = [...new Set(s.paneTabIds.filter((id): id is string => id != null))]
    await Promise.all(
      ids.map((tabId) => {
        const tab = s.tabs.find((t) => t.id === tabId)
        return tab ? loadListing(tab.path, { ...opts, tabId }) : Promise.resolve()
      })
    )
  }

  const OFFLINE_POLL_MS = 8_000
  /** Tree Drives list — live mounts only (not Offline-tab retry). */
  const DRIVE_POLL_MS = 10_000
  let offlinePollTimer: ReturnType<typeof setInterval> | null = null
  let offlinePollPath: string | null = null
  let drivePollTimer: ReturnType<typeof setInterval> | null = null
  let networkPollTimer: ReturnType<typeof setInterval> | null = null

  function stopOfflinePoll(): void {
    if (offlinePollTimer) {
      clearInterval(offlinePollTimer)
      offlinePollTimer = null
    }
    offlinePollPath = null
  }

  function drivesKey(list: DriveInfo[]): string {
    return list
      .map(
        (d) =>
          `${d.path.toLowerCase()}|${d.label}|${d.driveType ?? ''}|${d.offline ? 1 : 0}|${d.remotePath ?? ''}|${d.totalBytes ?? ''}|${d.freeBytes ?? ''}`
      )
      .join('\n')
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

  /** Start / stop background Network rediscovery from Settings → Network (Windows only). */
  function syncNetworkDiscoveryPoll(): void {
    if (networkPollTimer) {
      clearInterval(networkPollTimer)
      networkPollTimer = null
    }
    if (get().platform !== 'win32') return
    const nd = get().settings.networkDiscovery
    if (!nd || nd.enabled === false || nd.mode !== 'auto') return
    const ms = networkDiscoveryIntervalMs(nd)
    networkPollTimer = setInterval(() => {
      if (!get().booted) return
      if (get().settings.networkDiscovery.enabled === false) return
      if (get().network.status === 'running') return
      void get().startNetworkDiscovery()
    }, ms)
  }

  function stopNetworkDiscoveryUi(reason?: string): void {
    set((s) => ({
      network: {
        ...s.network,
        status: 'idle',
        hosts: [],
        sharesByHost: {},
        message: reason
      }
    }))
  }

  function isOfflineFailure(e: unknown): boolean {
    if (!(e instanceof IpcError)) return true
    // Unmounted / encrypted / network volumes usually surface as these.
    return (
      e.code === 'not-found' || e.code === 'not-allowed' || e.code === 'busy' || e.code === 'io'
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
  async function refreshMediaLibraryFolder(folderPath: string): Promise<void> {
    const s = get()
    if (!s.settings.mediaMetadata.enabled || !folderPath || isRemoteLocation(folderPath)) {
      if (s.mediaLibrary.isContainer || s.mediaLibrary.folderPath) {
        set({ mediaLibrary: emptyMediaLibrary() })
        resortCurrentListing()
      }
      return
    }
    try {
      const res = await call(api.mediaMetadata.folderLibrary({ path: folderPath }))
      // A slow metadata request for a folder we already left must not change
      // the current folder's grouping or resort its listing.
      const current = get()
      if (
        !samePath(current.activeTab().path, folderPath) ||
        !samePath(current.listing.path, folderPath)
      ) {
        return
      }
      const prev = get().mediaLibrary
      const same = prev.folderPath !== '' && samePath(prev.folderPath, folderPath)
      const items: Record<string, MediaLibraryItemFlags> = {}
      const genreSet = new Set<string>()
      for (const it of res.items) {
        items[it.path.toLowerCase()] = {
          watched: it.watched,
          genres: it.genres,
          kind: it.kind,
          season: it.season,
          episode: it.episode,
          title: it.title,
          showTitle: it.showTitle
        }
        for (const g of it.genres) {
          if (g.trim()) genreSet.add(g)
        }
      }
      const genreStill =
        same &&
        prev.genreFilter &&
        [...genreSet].some((g) => g.toLowerCase() === prev.genreFilter!.toLowerCase())
          ? prev.genreFilter
          : null
      set({
        mediaLibrary: {
          folderPath,
          isContainer: res.isContainer,
          items,
          watchedFilter: same ? prev.watchedFilter : 'all',
          genreFilter: genreStill
        }
      })
      resortCurrentListing()
    } catch {
      set({ mediaLibrary: emptyMediaLibrary() })
      resortCurrentListing()
    }
  }

  async function runMediaMetadataOp(
    label: string,
    paths: string[],
    work: (
      kindHints?: Record<string, 'movie' | 'show' | 'episode'>,
      pickHints?: Record<string, string>,
      nameHints?: Record<string, string>,
      retryPaths?: string[]
    ) => Promise<{
      done: number
      failed: { path: string; message: string }[]
      updated: string[]
      stoppedReason?: string
      needsKind?: { path: string; title: string }[]
      needsPick?: {
        path: string
        title: string
        suggested?: string
        candidates: { id: string; title: string; year?: number; subtitle?: string }[]
      }[]
      needsName?: { path: string; suggested: string; message: string }[]
    }>
  ): Promise<void> {
    if (!get().settings.mediaMetadata.enabled) return
    try {
      let hints: Record<string, 'movie' | 'show' | 'episode'> | undefined
      let pickHints: Record<string, string> | undefined
      let nameHints: Record<string, string> | undefined
      let res = await withBusyFeedback('media-metadata', label, undefined, () =>
        work(hints, pickHints, nameHints)
      )
      if (res.needsKind && res.needsKind.length > 0) {
        const extra: Record<string, 'movie' | 'show' | 'episode'> = { ...hints }
        for (const item of res.needsKind) {
          const choice = await get().askMediaKind({
            title: 'Movie or TV show?',
            message: `“${item.title}” could be a movie or a TV show. Which should we look up?`
          })
          if (!choice) break
          extra[item.path] = choice
        }
        if (Object.keys(extra).length > (hints ? Object.keys(hints).length : 0)) {
          hints = extra
          const pendingPick = res.needsPick
          const pendingName = res.needsName
          const again = await withBusyFeedback('media-metadata', label, undefined, () =>
            work(hints, pickHints, nameHints)
          )
          res = {
            done: res.done + again.done,
            failed: [...res.failed, ...again.failed],
            updated: [...res.updated, ...again.updated],
            stoppedReason: again.stoppedReason ?? res.stoppedReason,
            needsPick: [...(pendingPick ?? []), ...(again.needsPick ?? [])],
            needsName: [...(pendingName ?? []), ...(again.needsName ?? [])]
          }
        }
      }

      const dropPickHint = (filePath: string): void => {
        if (!pickHints) return
        const next = { ...pickHints }
        delete next[filePath]
        delete next[filePath.toLowerCase()]
        pickHints = Object.keys(next).length > 0 ? next : undefined
      }

      const resolveInteractive = async (item: {
        path: string
        title?: string
        suggested?: string
        message?: string
        candidates?: { id: string; title: string; year?: number; subtitle?: string }[]
        start: 'pick' | 'name'
      }): Promise<void> => {
        let suggested = item.suggested || item.title || basename(item.path)
        let message = item.message || `Several titles match “${item.title ?? suggested}”.`
        let queryTitle = item.title ?? suggested
        let candidates = item.candidates
        let mode: 'pick' | 'name' = item.start
        let nameTitle = item.start === 'name' ? 'No match' : 'Search as'
        let resolved = false
        while (!res.stoppedReason) {
          if (mode === 'name') {
            const typed = await get().askMediaName({
              title: nameTitle,
              message,
              fileName: basename(item.path),
              suggested
            })
            if (!typed) break
            suggested = typed
            queryTitle = typed
            nameHints = { ...nameHints, [item.path]: typed }
            dropPickHint(item.path)
          } else if (candidates && candidates.length > 0) {
            const choice = await get().askMediaPick({
              title: 'Which title?',
              message: `Several titles match “${queryTitle}”. Pick the one that fits, or search as a different name.`,
              candidates
            })
            if (!choice) break
            if (choice.action === 'search-as') {
              nameTitle = 'Search as'
              message = `Search again for ${basename(item.path)}. The name is sent as typed.`
              mode = 'name'
              continue
            }
            pickHints = { ...pickHints, [item.path]: choice.id }
          }
          const again = await withBusyFeedback('media-metadata', label, undefined, () =>
            work(hints, pickHints, nameHints, [item.path])
          )
          res.done += again.done
          res.updated.push(...again.updated)
          res.stoppedReason = again.stoppedReason ?? res.stoppedReason
          if (again.stoppedReason) break
          if (again.needsKind?.[0]) {
            const kind = await get().askMediaKind({
              title: 'Movie or TV show?',
              message: `“${again.needsKind[0].title}” could be a movie or a TV show. Which should we look up?`
            })
            if (!kind) break
            hints = { ...hints, [item.path]: kind }
            continue
          }
          if (again.needsPick?.[0]) {
            candidates = again.needsPick[0].candidates
            queryTitle = again.needsPick[0].title
            if (again.needsPick[0].suggested) suggested = again.needsPick[0].suggested
            mode = 'pick'
            continue
          }
          const miss =
            again.needsName?.[0] ?? again.failed.find((f) => isMediaNameMissError(f.message))
          if (miss && again.updated.length === 0) {
            message = miss.message
            if (again.needsName?.[0]?.suggested) suggested = again.needsName[0].suggested
            nameTitle = 'No match'
            mode = 'name'
            continue
          }
          if (again.failed.length > 0) res.failed.push(...again.failed)
          resolved = again.updated.length > 0 || again.failed.length > 0
          break
        }
        if (!resolved) {
          res.failed.push({ path: item.path, message })
        }
      }

      if (res.needsPick && res.needsPick.length > 0) {
        for (const item of res.needsPick) {
          if (res.stoppedReason) break
          await resolveInteractive({
            path: item.path,
            title: item.title,
            suggested: item.suggested,
            candidates: item.candidates,
            start: 'pick'
          })
        }
      }
      if (res.needsName && res.needsName.length > 0) {
        for (const item of res.needsName) {
          if (res.stoppedReason) break
          await resolveInteractive({
            path: item.path,
            suggested: item.suggested,
            message: item.message,
            start: 'name'
          })
        }
      }
      const folder = get().listing.path
      get().invalidateContentThumbs([
        ...(res.updated.length > 0 ? res.updated : paths),
        ...paths,
        ...(folder ? [folder] : [])
      ])
      if (folder) void refreshMediaLibraryFolder(folder)
      if (res.stoppedReason) {
        reportOperationError('Media metadata stopped', new Error(res.stoppedReason))
        return
      }
      const failN = res.failed.length
      if (failN > 0) {
        get().notify(
          `${res.done} updated · ${failN} failed${res.failed[0] ? ` (${res.failed[0].message})` : ''}`,
          true
        )
      } else if (res.done === 0) {
        get().notify(
          label.startsWith('Extract') || label.startsWith('Download')
            ? 'All items already have media metadata'
            : 'No media metadata to update'
        )
      } else {
        get().notify(
          res.done === 1 ? 'Media metadata saved' : `Media metadata saved for ${res.done} items`
        )
      }
    } catch (e) {
      if (isMediaApiLimitError(e)) {
        reportOperationError('Media metadata stopped', e)
        return
      }
      get().notify(e instanceof IpcError ? e.message : String(e), true)
    }
  }

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

  function openOpIssuesReview(opts: {
    op: 'copy' | 'move' | 'trash' | 'delete' | 'rename'
    issues: OpIssue[]
    destinationDir?: string
    clearCutAfter?: boolean
    doneCount: number
  }): void {
    if (opts.issues.length === 0) return
    set({
      dialog: {
        kind: 'op-issues',
        op: opts.op,
        issues: opts.issues,
        destinationDir: opts.destinationDir,
        clearCutAfter: opts.clearCutAfter,
        doneCount: opts.doneCount
      }
    })
  }

  async function nameConflictIssue(
    source: string,
    dest: string,
    message: string
  ): Promise<OpIssue> {
    let sourceMtimeMs: number | undefined
    let destMtimeMs: number | undefined
    try {
      sourceMtimeMs = (await call(api.fs.stat({ path: source }))).mtimeMs
    } catch {
      /* compare cards still load via checkConflicts */
    }
    try {
      destMtimeMs = (await call(api.fs.stat({ path: dest }))).mtimeMs
    } catch {
      /* dest may have vanished */
    }
    return {
      kind: 'name_conflict',
      code: 'conflict',
      source,
      dest,
      message,
      sourceMtimeMs,
      destMtimeMs
    }
  }

  async function runPermanentDelete(toDelete: string[]): Promise<void> {
    try {
      const autoSelectedPath = selectAfterDelete(toDelete)
      await releaseMediaLocks()
      const res = await withBusyFeedback(
        'delete',
        'Deleting…',
        toDelete.length === 1 ? basename(toDelete[0]!) : `${toDelete.length} items`,
        () => call(api.fs.deletePermanent({ paths: toDelete }))
      )
      if (res.deleted.length > 0) {
        await afterPathsRemoved(res.deleted, {
          expectedSelection: autoSelectedPath ? [autoSelectedPath] : []
        })
      }
      if (res.issues.length > 0) {
        get().notify(
          `Deleted ${res.deleted.length.toLocaleString()} · ${res.issues.length.toLocaleString()} need review`
        )
        openOpIssuesReview({
          op: 'delete',
          issues: res.issues,
          doneCount: res.deleted.length
        })
      } else {
        get().notify(
          `Permanently deleted ${res.deleted.length} item${res.deleted.length > 1 ? 's' : ''}`
        )
      }
    } catch (e) {
      clearMediaHold()
      reportOperationError('Delete failed', e)
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
        if (r.issues.length > 0) {
          get().notify(
            `Copied ${r.copied.toLocaleString()} · ${r.issues.length.toLocaleString()} need review`
          )
          openOpIssuesReview({
            op: 'copy',
            issues: r.issues,
            destinationDir: dest,
            clearCutAfter: clearCut,
            doneCount: r.copied
          })
        } else {
          get().notify(`Copied ${r.copied}, skipped ${r.skipped}`)
        }
        notifyTreeReload([dest])
      } else {
        if (r.movePairs.length > 0) {
          recordUndo({
            kind: 'move',
            pairs: r.movePairs,
            label: basename(r.movePairs[0]!.to)
          })
        }
        const movedSrc = r.movePairs.map((p) => p.from)
        if (movedSrc.length > 0) pruneListingRemoved(movedSrc)
        if (r.issues.length > 0) {
          get().notify(
            `Moved ${r.moved.toLocaleString()} · ${r.issues.length.toLocaleString()} need review`
          )
          openOpIssuesReview({
            op: 'move',
            issues: r.issues,
            destinationDir: dest,
            clearCutAfter: clearCut,
            doneCount: r.moved
          })
        } else {
          get().notify(`Moved ${r.moved}, skipped ${r.skipped}`)
        }
        notifyTreeMutation({ removed: movedSrc, reloadParents: [dest] })
      }
      if (clearCut) set({ clipboard: null })
      if (get().mediaHold) set({ mediaHold: false })
      await get().refresh()
      // After same-folder Keep both (and any successful copy into the open folder),
      // select the new paths so the user can see/rename the duplicates.
      if (op2 === 'copy' && r.copyPaths.length > 0 && samePath(dest, get().activeTab().path)) {
        get().setSelection(r.copyPaths, r.copyPaths[0]!, r.copyPaths[0]!)
      }
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
    issues: OpIssue[]
  }> {
    if (src.length === 0) {
      return { copied: 0, moved: 0, skipped: 0, copyPaths: [], movePairs: [], issues: [] }
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
        movePairs: [],
        issues: res.issues ?? []
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
      movePairs: res.moves,
      issues: res.issues ?? []
    }
  }

  /**
   * Arm directory watches for a folder under the size-tier policy.
   * Large folders (≥8k): parent only (detect gone/renamed); no active-dir soft-reload watch.
   */
  function armWatchesForPath(dirPath: string, entryCount: number): void {
    // Network host roots (`\\server`) are virtual share lists — don't watch.
    if (isNetworkHostUnc(dirPath)) {
      void api.fs.unwatch({ path: dirPath }).catch(() => {})
      return
    }
    const mode = watchArmModeForCount(entryCount)
    const parent = parentOf(dirPath)
    if (mode === 'full') {
      void api.fs.watch({ path: dirPath })
      if (parent && !isNetworkHostUnc(parent)) void api.fs.watch({ path: parent })
      return
    }
    // parent-only (or none): drop active-dir watch so we never soft-relist huge dirs
    void api.fs.unwatch({ path: dirPath }).catch(() => {})
    if (mode === 'parent-only' && parent && !isNetworkHostUnc(parent)) {
      void api.fs.watch({ path: parent })
    } else if (parent) {
      void api.fs.unwatch({ path: parent }).catch(() => {})
    }
  }

  /** Re-arm watches after suspend/release or watcher errors — uses current listing sizes. */
  function armWatchesForVisiblePanes(): void {
    const s = get()
    const paneTabs = s.tabs.filter((t) => s.paneTabIds.includes(t.id))
    const targets = paneTabs.length > 0 ? paneTabs : [s.activeTab()]
    for (const tab of targets) {
      if (!tab.path) continue
      const n = s.listingsByTabId[tab.id]?.entries.length ?? 0
      armWatchesForPath(tab.path, n)
    }
  }

  function currentListingFoldersFirst(listingPath?: string): boolean {
    const s = get()
    const tab = s.activeTab()
    const owning = resolveFolderView(tab.path, s.settings.folderViews)
    return listingFoldersFirst({
      foldersFirst: s.settings.foldersFirst,
      mediaEnabled: s.settings.mediaMetadata.enabled,
      mixFilesAndFolders: s.settings.mediaMetadata.mixFilesAndFolders === true,
      isContainer: s.mediaLibrary.isContainer,
      listingPath: listingPath ?? s.listing.path,
      containerPath: s.mediaLibrary.folderPath,
      viewMode: owning?.viewMode ?? tab.viewMode
    })
  }

  function resortCurrentListing(): void {
    const s = get()
    const tab = s.activeTab()
    if (!tab || tab.search.active || s.recycleBin.active) return
    const listing = s.listingsByTabId[tab.id] ?? s.listing
    if (!listing.path || listing.entries.length === 0) return
    const owning = resolveFolderView(tab.path, s.settings.folderViews)
    const sort = owning?.sort ?? tab.sort
    const sorted = sortEntries(
      listing.entries,
      sort,
      currentListingFoldersFirst(listing.path)
    )
    viewOrderCache = null
    const nextListing = { ...listing, entries: sorted }
    set({
      listing: tab.id === s.activeTabId ? nextListing : s.listing,
      listingsByTabId: { ...s.listingsByTabId, [tab.id]: nextListing }
    })
  }

  function commitListing(
    tabId: string,
    listedPath: string,
    entries: DirEntry[],
    opts?: { preserveSelection?: boolean; clearRemoteBusy?: boolean }
  ): DirEntry[] {
    const tab = get().tabs.find((t) => t.id === tabId) ?? get().activeTab()
    const owning = resolveFolderView(tab.path, get().settings.folderViews)
    const sort = owning?.sort ?? tab.sort
    const sortedEntries = dedupeDirEntries(
      sortEntries(entries, sort, currentListingFoldersFirst(listedPath))
    )
    const nextListing: Listing = {
      path: listedPath,
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
        listing:
          tabId === s.activeTabId ? nextListing : syncActiveListing(listingsByTabId, s.activeTabId),
        tabs,
        ...(opts?.clearRemoteBusy && s.remoteBusyDialog?.status === 'working'
          ? { remoteBusyDialog: null }
          : {})
      }
    })
    return sortedEntries
  }

  function afterListingPainted(tabId: string, path: string, sortedEntries: DirEntry[]): void {
    if (get().activeTabId === tabId) {
      stopOfflinePoll()
      void refreshMediaLibraryFolder(path)
    }
    armWatchesForPath(path, sortedEntries.length)
    if (tabId === get().activeTabId) {
      viewOrderCache = null
      // Re-sorting 200k rows on the next tick freezes the UI; delete-next builds this lazily.
      if (sortedEntries.length < WATCH_THROTTLED_MAX) {
        queueMicrotask(() => {
          try {
            pathsInViewOrder()
          } catch {
            /* ignore */
          }
        })
      }
    }
  }

  async function loadListing(
    path: string,
    opts?: {
      preserveSelection?: boolean
      soft?: boolean
      tabId?: string
      force?: boolean
      history?: boolean
    }
  ): Promise<void> {
    const tabId = opts?.tabId ?? get().activeTabId
    if (!tabId) return
    const seq = nextListSeq(tabId)
    const cached =
      !opts?.soft && !opts?.force
        ? (listingCacheOk(path, get().drives) ? remoteListingCache.get(path) : undefined) ??
          (opts?.history ? historyListingCache.get(path) : undefined)
        : undefined
    const paintFromCache = cached != null
    const showRemoteBusy =
      isRemoteLocation(path) && !opts?.soft && !paintFromCache && tabId === get().activeTabId
    const remoteLabel = (() => {
      const loc = parseRemoteLocation(path)
      if (!loc) return 'folder'
      if (loc.remotePath === '/') return 'remote folder'
      return remoteBasename(loc.remotePath) || 'folder'
    })()
    if (paintFromCache) {
      const painted = commitListing(tabId, path, cached, {
        preserveSelection: opts?.preserveSelection
      })
      afterListingPainted(tabId, path, painted)
    } else if (!opts?.soft) {
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
          listing: tabId === s.activeTabId ? nextListing : s.listing,
          ...(showRemoteBusy
            ? {
                remoteBusyDialog: {
                  status: 'working' as const,
                  title: 'Opening',
                  message: `Opening ${remoteLabel}…`
                }
              }
            : {})
        }
      })
    }
    try {
      const res = await call(api.fs.list({ path, includeHidden: true }))
      if (seq !== listRequestSeqByTab.get(tabId)) return // superseded
      if (opts?.soft) lastSoftReloadAtByPath.set(path.toLowerCase(), Date.now())
      const sortedEntries = commitListing(tabId, res.path, res.entries, {
        preserveSelection: opts?.preserveSelection,
        clearRemoteBusy: showRemoteBusy
      })
      rememberRemoteListing(res.path, sortedEntries, get().drives)
      historyListingCache.set(res.path, sortedEntries)
      afterListingPainted(tabId, path, sortedEntries)
      // Clear “(Disconnected)” in the tree as soon as a mapped letter is reachable again.
      const driveRoot = /^([a-zA-Z]:)\\/i.exec(path)
      if (driveRoot) {
        const root = `${driveRoot[1]!.toUpperCase()}\\`
        if (get().drives.some((d) => d.offline && d.path.toUpperCase() === root)) {
          void get().refreshDrivesNow()
        }
      }
    } catch (e) {
      if (seq !== listRequestSeqByTab.get(tabId)) return
      if (paintFromCache) {
        // Keep the snapshot; a brief NAS blip should not blank the pane.
        return
      }
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
          listing: tabId === s.activeTabId ? nextListing : s.listing,
          ...(showRemoteBusy
            ? {
                remoteBusyDialog: {
                  status: 'error' as const,
                  title: 'Could not open folder',
                  message: `Could not open ${remoteLabel}.`,
                  detail: message
                }
              }
            : {})
        }
      })
      if (offline && tabId === get().activeTabId) startOfflinePoll(path, tabId)
      else if (tabId === get().activeTabId) stopOfflinePoll()
    }
  }

  function updateTab(tabId: string, patch: Partial<Tab>): void {
    set((s) => {
      const tabs = s.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t))
      const active = tabs.find((t) => t.id === s.activeTabId)
      return { tabs, search: active?.search ?? s.search }
    })
    scheduleSessionSave()
  }

  function updateActiveTab(patch: Partial<Tab>): void {
    updateTab(get().activeTabId, patch)
  }

  async function applyTabHistoryEntry(
    tabId: string,
    entry: HistoryEntry,
    stacks: { back: HistoryEntry[]; forward: HistoryEntry[] }
  ): Promise<void> {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return
    const path = historyLocationPath(entry)
    if (entry.kind === 'search') {
      updateTab(tabId, {
        path,
        back: stacks.back,
        forward: stacks.forward,
        selected: [],
        search: {
          ...emptyTabSearch(entry.indexedOnly),
          active: true,
          query: entry.query,
          indexedOnly: entry.indexedOnly,
          running: true,
          progress: 'Starting search…'
        }
      })
      await loadListing(path, { tabId })
      await get().runSearch(tabId)
      return
    }
    const focusPath = entry.kind === 'folder' ? entry.focusPath : undefined
    updateTab(tabId, {
      path,
      back: stacks.back,
      forward: stacks.forward,
      // Set the history target before the NAS request completes. The row can
      // highlight as soon as a cached/current listing is painted.
      selected: focusPath ? [focusPath] : [],
      scrollOffset: entry.kind === 'folder' ? (entry.scrollOffset ?? 0) : 0,
      search: emptyTabSearch(tab.search.indexedOnly)
    })
    if (tabId === get().activeTabId) {
      set({
        selectionAnchor: focusPath ?? null,
        focusedPath: focusPath ?? null
      })
      get().clearFileListScrollRequest()
    }
    await loadListing(path, { tabId, history: true })
  }

  /** Always surface FS failures in a modal — never status-bar-only. */
  function reportOperationError(
    title: string,
    e: unknown,
    extra?: { retryFolderStats?: { path: string } }
  ): void {
    if (e instanceof IpcError && e.code === 'cancelled') {
      get().notify('Cancelled')
      return
    }
    const message = e instanceof IpcError ? e.message : String(e)
    const detail = e instanceof IpcError ? e.envelope.remediation : undefined
    const path = e instanceof IpcError ? e.envelope.path : undefined
    set({
      dialog: {
        kind: 'alert',
        title,
        message,
        detail,
        path,
        ...(extra?.retryFolderStats ? { retryFolderStats: extra.retryFolderStats } : {})
      }
    })
    get().notify(message.split('\n')[0] ?? message, true)
  }

  function notifyTreeMutation(opts: {
    removed?: string[]
    reloadParents?: string[]
    renamed?: { from: string; to: string }[]
  }): void {
    dropRemoteListingCaches(opts.removed ?? [])
    dropRemoteListingCaches(opts.reloadParents ?? [])
    set((s) => ({
      treeMutation: {
        rev: s.treeMutation.rev + 1,
        removed: opts.removed ? [...opts.removed] : [],
        reloadParents: opts.reloadParents ? [...opts.reloadParents] : [],
        renamed: opts.renamed ? [...opts.renamed] : []
      }
    }))
  }

  /** Keep the typed name on screen while the network rename + re-list catch up. */
  function applyListingRename(from: string, to: string, newName: string): void {
    const destTaken = (entries: { path: string }[]): boolean =>
      renameDestOccupied(entries, from, to)
    const rewrite = (p: string, occupied: boolean): string =>
      occupied ? p : rewritePathAfterRename(p, from, to)
    set((s) => {
      const occupied =
        destTaken(s.listing.entries) ||
        Object.values(s.listingsByTabId).some((L) => destTaken(L.entries))
      const listingsByTabId: Record<string, Listing> = {}
      for (const [tid, L] of Object.entries(s.listingsByTabId)) {
        const t = s.tabs.find((x) => x.id === tid)
        const owning = t ? resolveFolderView(t.path, s.settings.folderViews) : undefined
        const sort = owning?.sort ?? t?.sort ?? { key: 'name' as const, dir: 'asc' as const }
        listingsByTabId[tid] = {
          ...L,
          entries: sortEntries(
            patchDirEntriesForRename(L.entries, from, to, newName),
            sort,
            currentListingFoldersFirst(L.path)
          )
        }
      }
      const listing =
        listingsByTabId[s.activeTabId] ??
        (() => {
          const tab = s.tabs.find((x) => x.id === s.activeTabId)
          const owning = tab ? resolveFolderView(tab.path, s.settings.folderViews) : undefined
          const sort = owning?.sort ?? tab?.sort ?? { key: 'name' as const, dir: 'asc' as const }
          return {
            ...s.listing,
            entries: sortEntries(
              patchDirEntriesForRename(s.listing.entries, from, to, newName),
              sort,
              currentListingFoldersFirst(s.listing.path)
            )
          }
        })()
      const tabs = s.tabs.map((t) => ({
        ...t,
        path: rewrite(t.path, occupied),
        rootPath: t.rootPath ? rewrite(t.rootPath, occupied) : null,
        selected: t.selected.map((p) => rewrite(p, occupied)),
        treeExpanded: t.treeExpanded.map((p) => rewrite(p, occupied)),
        search: t.search.active
          ? {
              ...t.search,
              results: t.search.results.map((r) => ({
                ...r,
                path: rewrite(r.path, occupied),
                name: samePath(r.path, from) ? newName : r.name
              })),
              walkItems: t.search.walkItems.map((r) => ({
                ...r,
                path: rewrite(r.path, occupied),
                name: samePath(r.path, from) ? newName : r.name
              }))
            }
          : t.search
      }))
      const activeSearch = tabs.find((t) => t.id === s.activeTabId)?.search ?? s.search
      viewOrderCache = null
      const keepRename =
        !!s.renamingPath && !samePath(s.renamingPath, from) && !samePath(s.renamingPath, to)
      return {
        renamingPath: keepRename ? s.renamingPath : null,
        renameSource: keepRename ? s.renameSource : null,
        listingsByTabId,
        listing,
        tabs,
        search: activeSearch,
        focusedPath: s.focusedPath ? rewrite(s.focusedPath, occupied) : null,
        selectionAnchor: s.selectionAnchor ? rewrite(s.selectionAnchor, occupied) : null,
        treeFocusPath: s.treeFocusPath ? rewrite(s.treeFocusPath, occupied) : null
      }
    })
    const after = get()
    for (const L of Object.values(after.listingsByTabId)) {
      rememberRemoteListing(L.path, L.entries, after.drives)
    }
    const tab = after.tabs.find((t) => t.id === after.activeTabId)
    if (
      renameShouldFollow({
        renamingPath: after.renamingPath,
        focusedPath: after.focusedPath,
        selected: tab?.selected ?? [],
        paths: [from, to]
      })
    ) {
      get().requestFileListScrollTo(to)
    }
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
        (samePath(t.path, dirPath) || samePath(s.listingsByTabId[t.id]?.path ?? '', dirPath))
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
      const minGap = softReloadMinGapMs(n)
      if (!Number.isFinite(minGap)) {
        // ≥8k: no watch-driven soft re-list
        continue
      }
      const last = lastSoftReloadAtByPath.get(dirPath.toLowerCase()) ?? 0
      const wait = Math.max(SOFT_RELOAD_GAP_FAST_MS, last + minGap - Date.now())
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
    const gone = (p: string): boolean => removed.some((r) => samePath(p, r) || isUnderPath(p, r))
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
    mediaLibrary: MediaLibraryState
  }): string {
    return `${s.settings.viewFilterEnabled ? 1 : 0}|${s.settings.viewFilterPatterns.join('\n')}|${s.mediaLibrary.watchedFilter}|${s.mediaLibrary.genreFilter ?? ''}`
  }

  /** Sorted/filtered paths matching the file view (cached; pruned in place on delete). */
  function pathsInViewOrder(): string[] {
    const s = get()
    const tab = s.activeTab()
    const sourceEntries = tab.search.active
      ? searchResultsToEntries(tab.search.results)
      : s.listing.entries
    const listingRef = tab.search.active ? tab.search.results : s.listing.entries
    const owning = resolveFolderView(tab.path, s.settings.folderViews)
    const sort = owning?.sort ?? tab.sort
    const filterKey = viewOrderFilterKey(s)
    if (
      viewOrderCache &&
      viewOrderCache.listingRef === listingRef &&
      viewOrderCache.sortKey === sort.key &&
      viewOrderCache.sortDir === sort.dir &&
      viewOrderCache.foldersFirst ===
        listingFoldersFirst({
          foldersFirst: s.settings.foldersFirst,
          mediaEnabled: s.settings.mediaMetadata.enabled,
          mixFilesAndFolders: s.settings.mediaMetadata.mixFilesAndFolders === true,
          isContainer: s.mediaLibrary.isContainer,
          listingPath: s.listing.path,
          containerPath: s.mediaLibrary.folderPath,
          viewMode: owning?.viewMode ?? tab.viewMode
        }) &&
      viewOrderCache.filterKey === filterKey
    ) {
      return viewOrderCache.paths
    }
    const applyMedia =
      s.mediaLibrary.isContainer &&
      !tab.search.active &&
      s.listing.path &&
      samePath(s.listing.path, s.mediaLibrary.folderPath)
    const foldersFirst = tab.search.active
      ? s.settings.foldersFirst
        : listingFoldersFirst({
            foldersFirst: s.settings.foldersFirst,
            mediaEnabled: s.settings.mediaMetadata.enabled,
            mixFilesAndFolders: s.settings.mediaMetadata.mixFilesAndFolders === true,
            isContainer: s.mediaLibrary.isContainer,
            listingPath: s.listing.path,
            containerPath: s.mediaLibrary.folderPath,
            viewMode: owning?.viewMode ?? tab.viewMode
          })
    const before = sortEntries(
      sourceEntries.filter((e) => {
        if (
          isExcludedByViewFilter(e, s.settings.viewFilterPatterns, s.settings.viewFilterEnabled, {
            ignoreHiddenAttr: tab.search.active
          })
        ) {
          return false
        }
        if (applyMedia && isExcludedByMediaLibrary(e.path, s.mediaLibrary)) return false
        return true
      }),
      sort,
      foldersFirst
    )
    const paths = before.map((e) => e.path)
    viewOrderCache = {
      listingRef,
      sortKey: sort.key,
      sortDir: sort.dir,
      foldersFirst,
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
    const pathGone = (p: string): boolean =>
      gone.has(p.toLowerCase()) || removed.some((r) => isUnderPath(p, r))
    set((s) => {
      const listingsByTabId: Record<string, Listing> = {}
      for (const [tid, L] of Object.entries(s.listingsByTabId)) {
        listingsByTabId[tid] = {
          ...L,
          entries: L.entries.filter((e) => !pathGone(e.path))
        }
      }
      const activeListing = listingsByTabId[s.activeTabId] ?? {
        ...s.listing,
        entries: s.listing.entries.filter((e) => !pathGone(e.path))
      }
      const tabs = s.tabs.map((t) => {
        if (!t.search.active) return t
        const dismissed = mergeDismissedPaths(t.search.dismissed ?? [], removed)
        const results = pruneSearchResultItems(t.search.results, dismissed)
        if (dismissed === t.search.dismissed && results === t.search.results) return t
        return { ...t, search: { ...t.search, results, dismissed } }
      })
      const activeSearch = tabs.find((t) => t.id === s.activeTabId)?.search ?? s.search
      if (
        viewOrderCache &&
        (viewOrderCache.listingRef === s.listing.entries ||
          viewOrderCache.listingRef === s.search.results)
      ) {
        viewOrderCache = {
          ...viewOrderCache,
          listingRef: activeSearch.active ? activeSearch.results : activeListing.entries,
          paths: viewOrderCache.paths.filter((p) => !pathGone(p))
        }
      } else {
        viewOrderCache = null
      }
      return { listingsByTabId, listing: activeListing, tabs, search: activeSearch }
    })
    const after = get()
    for (const L of Object.values(after.listingsByTabId)) {
      rememberRemoteListing(L.path, L.entries, after.drives)
    }
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

  async function closeTabsWhoseRootWasDeleted(removed: string[]): Promise<void> {
    const doomed = tabsWhoseRootIsDeleted(get().tabs, removed)
    if (doomed.length === 0) return
    const fallback = get().homePath || get().settings.defaultNewTabPath
    if (doomed.length >= get().tabs.length && fallback) {
      await get().newTab(fallback)
    }
    for (const tab of tabsWhoseRootIsDeleted(get().tabs, removed)) {
      if (get().tabs.length <= 1) break
      await get().closeTab(tab.id)
    }
  }

  async function afterPathsRemoved(
    removed: string[],
    opts?: { expectedSelection?: string[] }
  ): Promise<void> {
    syncImageViewerAfterDelete(removed)
    notifyTreeRemoved(removed)
    const activeDoomed = tabsWhoseRootIsDeleted(get().tabs, removed).some(
      (t) => t.id === get().activeTabId
    )
    if (activeDoomed) {
      pruneListingRemoved(removed)
      clearMediaHold()
      await closeTabsWhoseRootWasDeleted(removed)
      return
    }

    const tab = get().activeTab()
    const current = tab.path
    const primary = removed.find((p) => samePath(p, current) || isUnderPath(current, p)) ?? null

    if (!primary) {
      // Stay in-folder: listing was already pruned + selection updated before trash.
      // Do NOT full-refresh — readdir+stat of large folders is multi-second.
      pruneListingRemoved(removed)
      const currentSelection = get().activeTab().selected
      const expectedSelection = opts?.expectedSelection
      const selectionChangedDuringRemoval =
        expectedSelection !== undefined &&
        (currentSelection.length !== expectedSelection.length ||
          currentSelection.some(
            (path, index) => !expectedSelection[index] || !samePath(path, expectedSelection[index]!)
          ))
      if (selectionChangedDuringRemoval) {
        const stillSelected = currentSelection.filter(
          (path) =>
            !removed.some(
              (removedPath) => samePath(path, removedPath) || isUnderPath(path, removedPath)
            )
        )
        const currentAnchor = get().selectionAnchor
        const currentFocus = get().focusedPath
        const anchor =
          currentAnchor && stillSelected.some((path) => samePath(path, currentAnchor))
            ? currentAnchor
            : stillSelected[0] ?? null
        const focused =
          currentFocus && stillSelected.some((path) => samePath(path, currentFocus))
            ? currentFocus
            : stillSelected[stillSelected.length - 1] ?? null
        updateActiveTab({ selected: stillSelected })
        set({ selectionAnchor: anchor, focusedPath: focused })
      } else {
        const focused = get().focusedPath
        const nextPath =
          focused && get().listing.entries.some((e) => samePath(e.path, focused)) ? focused : null
        if (nextPath) {
          updateActiveTab({ selected: [nextPath] })
          set({ selectionAnchor: nextPath, focusedPath: nextPath })
        } else {
          updateActiveTab({ selected: [] })
          set({ selectionAnchor: null, focusedPath: null })
        }
      }
      clearMediaHold()
      // Trash/move suspend closes ReadDirectoryChanges handles — re-arm without re-list.
      armWatchesForVisiblePanes()
      await closeTabsWhoseRootWasDeleted(removed)
      return
    }

    const parent = parentOf(primary)
    if (!parent) {
      const fallback = get().homePath || get().settings.defaultNewTabPath
      if (fallback) await get().navigate(fallback)
      await closeTabsWhoseRootWasDeleted(removed)
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

    await get().navigate(nextPath)
    // Don't leave deleted folders in back/forward history.
    const gone = (p: string): boolean => removed.some((r) => samePath(p, r) || isUnderPath(p, r))
    const t = get().activeTab()
    updateActiveTab({
      back: t.back.filter((e) => !gone(historyLocationPath(e))),
      forward: t.forward.filter((e) => !gone(historyLocationPath(e))),
      selected: []
    })
    clearMediaHold()
    await closeTabsWhoseRootWasDeleted(removed)
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
    const existing = paths.filter((p) => get().listing.entries.some((e) => samePath(e.path, p)))
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
        const res = await withBusyFeedback('trash', 'Restoring…', entry.label, () =>
          call(api.fs.restoreFromTrash({ paths: entry.paths }))
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
        await selectPathsPreferParent(
          pathsAfterUndo(entry).filter((p) => res.restored.some((r) => samePath(r, p)))
        )
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
      await selectPathsPreferParent(
        direction === 'undo' ? pathsAfterUndo(entry) : pathsAfterRedo(entry)
      )
      return
    }

    // move | power-rename
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
    await selectPathsPreferParent(
      direction === 'undo' ? pathsAfterUndo(entry) : pathsAfterRedo(entry)
    )
  }

  const slideshowActions = createSlideshowActions(
    get as unknown as Parameters<typeof createSlideshowActions>[0],
    set as unknown as Parameters<typeof createSlideshowActions>[1]
  )

  return {
    ...slideshowActions,
    booted: false,
    platform: 'linux',
    settings: null as unknown as Settings, // set during boot before UI renders
    homePath: '',
    knownFolders: [],
    drives: [],
    network: {
      status: 'idle',
      hosts: [],
      sharesByHost: {},
      generation: 0
    },
    tabs: [],
    activeTabId: '',
    closedTabs: [],
    splitters: {
      treeWidthPx: 240,
      previewWidthPx: 320,
      treeCollapsed: false,
      previewCollapsed: false
    },
    viewLayout: 1,
    paneTabIds: [],
    paneTreeCollapsed: [false],
    focusedPaneIndex: 0,
    paneSplitCols: 0.5,
    paneSplitRows: 0.5,
    listingsByTabId: {},
    listing: { path: '', entries: [], loading: false, error: null, offline: false },
    selectionAnchor: null,
    focusedPath: null,
    fileListScrollRequest: null,
    renamingPath: null,
    renameSource: null,
    treeFocusPath: null,
    drivesOverview: false,
    clipboard: null,
    dragPaths: [],
    dropHighlightPath: null,
    dialog: null,
    dialogStack: [],
    scriptLibrary: [],
    imageViewer: null,
    imageEditor: null,
    imageVersionPreview: null,
    mediaHold: false,
    previewWindowOpen: false,
    contextMenu: null,
    devGateActive: false,
    devGatePresent: false,
    devGateEnable: false,
    search: emptyTabSearch(),
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
    thumbRevByPath: {},
    columnMetaBump: { rev: 0, path: null },
    notice: null,
    remoteBusyDialog: null,
    addressEditing: false,
    treeMutation: { rev: 0, removed: [], reloadParents: [], renamed: [] },
    treeRefreshRev: 0,
    treeCollapseRequest: { tabId: '', rev: 0 },
    undoStack: [],
    redoStack: [],
    slideshow: emptySlideshowSession(),
    mediaLibrary: emptyMediaLibrary(),

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

    flushSession() {
      flushSessionSave()
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
      const [settings, session, home, ready, devGateRes, ...knownPathResults] = await Promise.all([
        call(api.settings.get()),
        call(api.session.get()),
        call(api.app.getPath({ name: 'home' })),
        call(api.app.ready()),
        call(api.app.devGate()),
        ...knownSpecs.map((k) =>
          call(api.app.getPath({ name: k.id })).catch(() => ({ path: '' as string }))
        )
      ])
      // Parallel exists checks — do not serialize round-trips before first paint.
      const knownFolders: KnownFolder[] = (
        await Promise.all(
          knownSpecs.map(async (spec, i) => {
            const p = knownPathResults[i]?.path
            if (!p) return null
            try {
              if ((await call(api.fs.exists({ path: p }))).exists) {
                return { id: spec.id, label: spec.label, path: p } satisfies KnownFolder
              }
            } catch {
              /* skip */
            }
            return null
          })
        )
      ).filter((k): k is KnownFolder => k != null)

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
            icon: defaultTabIcon(defaultPath, null),
            viewMode: 'largeIcons',
            sort: { key: 'name', dir: 'asc' },
            back: [],
            forward: [],
            selected: [],
            scrollOffset: 0,
            rootPath: null,
            treeExpanded: [],
            search: emptyTabSearch()
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

      const viewLayout = coerceViewLayout(session.viewLayout)
      const paneTreeCollapsed = sanitizePaneTreeCollapsed(
        session.paneTreeCollapsed,
        viewLayout,
        session.splitters.treeCollapsed === true
      )
      const tabIds = tabs.map((t) => t.id)
      let paneTabIds = fillPaneSlots(
        viewLayout,
        session.paneTabIds?.length ? session.paneTabIds : [activeTabId],
        tabIds,
        activeTabId
      )
      let focusedPaneIndex = Math.min(viewLayout - 1, Math.max(0, session.focusedPaneIndex ?? 0))
      if (paneTabIds[focusedPaneIndex] !== activeTabId) {
        const idx = paneTabIds.indexOf(activeTabId)
        if (idx >= 0) focusedPaneIndex = idx
        else {
          paneTabIds = [...paneTabIds]
          paneTabIds[focusedPaneIndex] = activeTabId
          paneTabIds = fillPaneSlots(viewLayout, paneTabIds, tabIds, activeTabId)
        }
      }

      set({
        booted: true,
        platform: ready.platform,
        settings,
        homePath: home.path,
        knownFolders,
        drives: [],
        tabs,
        activeTabId,
        closedTabs: session.closedTabs ?? [],
        splitters,
        viewLayout,
        paneTabIds,
        paneTreeCollapsed,
        focusedPaneIndex,
        paneSplitCols: clampPaneRatio(session.paneSplitCols ?? 0.5),
        paneSplitRows: clampPaneRatio(session.paneSplitRows ?? 0.5),
        listingsByTabId: {},
        selectionAnchor: focus.selectionAnchor,
        focusedPath: focus.focusedPath,
        devGateActive: devGateRes.active === true,
        devGatePresent: devGateRes.present === true,
        devGateEnable: devGateRes.enable === true,
        search: activeTab.search,
        slideshow: {
          ...emptySlideshowSession(),
          cacheActive: settings.slideshow.cacheActive === true,
          imageListCache: [...(settings.slideshow.imageListCache ?? [])],
          categorizerMap: [...(settings.slideshow.categorizerMap ?? [])]
        }
      })
      void get().refreshScriptLibrary()

      api.onEvent((event: MfeEvent) => {
        const s = get()
        if (event.type === 'fs-changed') {
          const changed = event.payload.path
          dropRemoteListingCaches([changed])
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
        } else if (event.type === 'fs-watch-lost') {
          // Watcher closed (error / handle drop) — re-arm if still showing that folder.
          const lost = event.payload.path
          const s2 = get()
          const visible = s2.tabs.filter((t) => s2.paneTabIds.includes(t.id))
          const tabs = visible.length > 0 ? visible : [s2.activeTab()]
          for (const tab of tabs) {
            const parent = parentOf(tab.path)
            if (samePath(tab.path, lost) || (parent && samePath(parent, lost))) {
              const n = s2.listingsByTabId[tab.id]?.entries.length ?? 0
              armWatchesForPath(tab.path, n)
            }
          }
        } else if (event.type === 'search-progress') {
          const p = event.payload
          const owner = get().tabs.find(
            (t) => t.search.running && (p.gen == null || p.gen === t.search.gen)
          )
          if (!owner) return
          const st = owner.search
          const patch: Partial<SearchState> = {}
          if (p.phase !== 'done') {
            const text = formatSearchProgress(p)
            if (text) patch.progress = text
          }
          if (p.items) {
            const walkItems = pruneSearchResultItems(p.items, st.dismissed ?? [])
            patch.walkItems = walkItems
            patch.results = narrowSearchItems(walkItems, st.walkQuery, st.query)
          }
          if (Object.keys(patch).length > 0) {
            updateTab(owner.id, { search: { ...st, ...patch } })
          }
        } else if (event.type === 'script-ended') {
          // Scripts can create/rename/delete anywhere under the folder or selection.
          // Watchers only cover the current listing, so do a full F5 (list + tree).
          if (!event.payload.dryRun) void get().refresh()
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
            set((state) => (state.fileOp?.opId === p.opId ? { fileOp: null } : {}))
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
        } else if (event.type === 'slideshow-list-progress') {
          const a = get().slideshow.active
          if (a?.status === 'building') {
            set({
              slideshow: {
                ...get().slideshow,
                active: {
                  ...a,
                  buildFound: event.payload.found,
                  buildCurrent: event.payload.current ?? a.buildCurrent
                }
              }
            })
          }
        } else if (event.type === 'compiled-playlist-apply') {
          const p = event.payload
          if (typeof p.total === 'number') {
            get().applyCompiledVirtual(
              {
                total: p.total,
                index: p.index,
                path: p.path,
                truncated: p.truncated,
                resumePlaying: p.resumePlaying === true
              },
              p.rev
            )
          } else if (p.paths) {
            get().applyCompiledPlaylist(p.paths, p.preferPath, p.rev)
          }
        } else if (event.type === 'preview-window') {
          set({ previewWindowOpen: event.payload.open })
        } else if (event.type === 'compiled-lists-window-closed') {
          const a = get().slideshow.active
          if (a?.compiledMode) void get().stopSlideshow()
        } else if (event.type === 'dev-gate') {
          const p = event.payload
          const dialog = get().dialog
          set({
            devGateActive: p.active === true,
            devGatePresent: p.present === true,
            devGateEnable: p.enable === true,
            dialog:
              !p.active && dialog?.kind === 'compiled-lists-config' ? null : dialog
          })
        } else if (event.type === 'network-discovery') {
          const p = event.payload
          set((state) => {
            if (p.generation < state.network.generation && p.status !== 'running') {
              return {}
            }
            const incoming = p.hosts
            let hosts = state.network.hosts
            if (p.status === 'running') {
              // Empty running: keep prior online list (no flash). Non-empty: union so
              // rediscovery does not drop still-probing hosts until done replaces.
              if (incoming && incoming.length > 0) {
                const byKey = new Map(
                  state.network.hosts.map((h) => [h.unc.toLowerCase(), h] as const)
                )
                for (const h of incoming) {
                  byKey.set(h.unc.toLowerCase(), h)
                }
                hosts = [...byKey.values()].sort((a, b) =>
                  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
                )
              }
            } else if (incoming) {
              // done: replace with reachable-only (empty → hide Network).
              // error + empty: keep prior list rather than wiping on a transient failure.
              if (p.status === 'done' || incoming.length > 0) {
                hosts = incoming
              }
            }
            return {
              network: {
                ...state.network,
                generation: Math.max(state.network.generation, p.generation),
                status:
                  p.status === 'running' ? 'running' : p.status === 'error' ? 'error' : 'done',
                hosts,
                message: p.message
              }
            }
          })
        }
      })

      void get().refreshIndexRoots()
      startDrivePoll()
      syncNetworkDiscoveryPoll()
      // Paint shell first; drives / listings / LAN discovery refresh in the background.
      void get().refreshDrivesNow()
      void (async () => {
        try {
          await loadVisiblePaneListings()
        } catch {
          /* listings soft-fail per pane */
        }
        const active = get().activeTab()
        if (active.search.active && active.search.query.trim()) {
          void get().runSearch()
        }
        if (get().platform !== 'win32') return
        // Defer discovery so PowerShell/ARP does not compete with first folder lists / icons.
        window.setTimeout(() => {
          if (!get().booted) return
          void get().startNetworkDiscovery()
        }, 1500)
      })()
      // One-time migration: old builds only stored a file path — import if settings map empty.
      if (
        get().settings.slideshowFeaturesEnabled &&
        (get().settings.slideshow.categorizerMap?.length ?? 0) === 0 &&
        get().settings.slideshow.categorizerMapPath
      ) {
        void loadCategorizerMapFromPath(
          get as unknown as Parameters<typeof loadCategorizerMapFromPath>[0],
          set as unknown as Parameters<typeof loadCategorizerMapFromPath>[1],
          get().settings.slideshow.categorizerMapPath
        ).catch(() => {})
      }
      scheduleSessionSave()
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
          get().requestFileListScrollTo(selectFile)
        }
        get().notify(selectFile ? `Revealed ${basename(selectFile)}` : `Opened ${basename(folder)}`)
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    notify(text, isError = false) {
      set({ notice: { text, isError } })
      if (noticeTimer) clearTimeout(noticeTimer)
      noticeTimer = setTimeout(() => set({ notice: null }), isError ? 6000 : 3000)
    },

    clearRemoteBusyDialog() {
      set({ remoteBusyDialog: null })
    },

    bumpColumnMeta(path) {
      invalidateThumbMemory(path)
      const key = thumbPathKey(path)
      set((s) => ({
        columnMetaBump: { rev: s.columnMetaBump.rev + 1, path },
        thumbRevByPath: {
          ...s.thumbRevByPath,
          [key]: (s.thumbRevByPath[key] ?? 0) + 1
        }
      }))
    },

    invalidateContentThumbs(paths) {
      const uniq = [...new Set(paths.filter(Boolean).map((p) => thumbPathKey(p)))]
      invalidateThumbMemoryMany(uniq)
      if (uniq.length === 0) {
        set((s) => ({ videoThumbRev: s.videoThumbRev + 1 }))
        return
      }
      set((s) => {
        const thumbRevByPath = { ...s.thumbRevByPath }
        for (const key of uniq) {
          thumbRevByPath[key] = (thumbRevByPath[key] ?? 0) + 1
        }
        return {
          columnMetaBump: {
            rev: s.columnMetaBump.rev + 1,
            path: paths[0] ?? s.columnMetaBump.path
          },
          thumbRevByPath,
          videoThumbRev: s.videoThumbRev + 1
        }
      })
    },

    async navigate(path, opts) {
      const push = opts?.push ?? true
      if (get().drivesOverview) set({ drivesOverview: false })
      const s = get()
      const tabId = opts?.tabId ?? s.activeTabId
      const tab = s.tabs.find((t) => t.id === tabId) ?? s.activeTab()
      const old = tab.path
      if (tab.rootPath && !isUnderPath(path, tab.rootPath)) {
        get().notify(`This tab is limited to ${basename(tab.rootPath)} — open a new tab to leave`)
        return
      }
      if (tabId === s.activeTabId) {
        if (get().recycleBin.active) get().closeRecycleBinView()
      }
      flushPendingRename()
      // Keep the rows that are already on screen as a history snapshot. This
      // covers mapped NAS drives whose remote type is not known yet and avoids
      // making Back wait for a fresh directory enumeration.
      const currentTab = get().tabs.find((t) => t.id === tabId)
      const currentListing =
        get().listingsByTabId[tabId] ?? (tabId === get().activeTabId ? get().listing : undefined)
      if (
        currentTab &&
        currentListing &&
        samePath(currentListing.path, currentTab.path) &&
        currentListing.entries.length > 0
      ) {
        historyListingCache.set(currentTab.path, currentListing.entries)
      }
      const leavingSearch = tab.search.active
      if (push && (!samePath(old, path) || leavingSearch)) {
        const here = currentLocation(tab)
        const last = tab.back[tab.back.length - 1]
        const back = last && sameHistoryEntry(last, here) ? tab.back : [...tab.back, here]
        updateTab(tabId, {
          path,
          back,
          forward: [],
          selected: [],
          scrollOffset: 0,
          search: emptyTabSearch(tab.search.indexedOnly)
        })
      } else {
        updateTab(tabId, {
          path,
          selected: [],
          search: leavingSearch ? emptyTabSearch(tab.search.indexedOnly) : tab.search
        })
      }
      if (tabId === get().activeTabId) {
        set({
          selectionAnchor: null,
          focusedPath: null,
          renamingPath: null,
          renameSource: null,
          addressEditing: false,
          fileListScrollRequest: null
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
      // Older sessions and locations opened from the tree have no stored
      // focus. In the common parent/child case, Explorer focuses the child
      // folder when Back returns to its parent.
      const parent = parentOf(tab.path)
      const fallbackFocus =
        prev.kind === 'folder' && parent && samePath(parent, prev.path) ? tab.path : undefined
      const target =
        prev.kind === 'folder' && !prev.focusPath && fallbackFocus
          ? { ...prev, focusPath: fallbackFocus }
          : prev
      await applyTabHistoryEntry(tab.id, target, {
        back: tab.back.slice(0, -1),
        forward: [currentLocation(tab), ...tab.forward]
      })
    },

    async goForward() {
      const tab = get().activeTab()
      const next = tab.forward[0]
      if (!next) return
      await applyTabHistoryEntry(tab.id, next, {
        back: [...tab.back, currentLocation(tab)],
        forward: tab.forward.slice(1)
      })
    },

    async goUp() {
      const tab = get().activeTab()
      if (tab.search.active) {
        get().clearSearch()
        return
      }
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
      // Same gesture as Explorer Refresh / Ctrl+R: re-probe Network (new PCs online)
      // and drop cached shares so expand re-lists. Fire-and-forget — don't block listing.
      if (get().settings.networkDiscovery.enabled !== false) {
        set((s) => ({
          network: {
            ...s.network,
            sharesByHost: {},
            status: 'running',
            message: undefined
          }
        }))
        void get().startNetworkDiscovery()
      }
      dropRemoteListingCaches(
        get()
          .tabs.filter((t) => get().paneTabIds.includes(t.id))
          .map((t) => t.path)
      )
      await loadVisiblePaneListings({ preserveSelection: true, force: true })
      // File list and tree keep separate caches — always refresh both.
      set((s) => ({ treeRefreshRev: s.treeRefreshRev + 1 }))
    },

    setAddressEditing(v) {
      set({ addressEditing: v })
    },

    async refreshDrivesNow() {
      try {
        const d = await call(api.fs.listDrives())
        set({ drives: d.drives })
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async startNetworkDiscovery() {
      if (get().settings.networkDiscovery.enabled === false) {
        stopNetworkDiscoveryUi()
        try {
          await call(api.network.cancelDiscovery())
        } catch {
          /* ignore */
        }
        return
      }
      try {
        set((s) => ({
          network: {
            ...s.network,
            status: 'running',
            message: undefined
          }
        }))
        const res = await call(api.network.startDiscovery())
        set((s) => ({
          network: { ...s.network, generation: res.generation }
        }))
      } catch (e) {
        set((s) => ({
          network: {
            ...s.network,
            status: 'error',
            message: e instanceof IpcError ? e.message : String(e)
          }
        }))
      }
    },

    async loadNetworkShares(server, opts) {
      const key = server.replace(/^\\\\/, '').split(/[\\/]/)[0]?.toLowerCase() ?? ''
      if (!key) return
      const existing = get().network.sharesByHost[key]
      if (!opts?.force && (existing?.status === 'loading' || existing?.status === 'done')) return
      set((s) => ({
        network: {
          ...s.network,
          sharesByHost: {
            ...s.network.sharesByHost,
            [key]: { status: 'loading', shares: opts?.force ? [] : (existing?.shares ?? []) }
          }
        }
      }))
      try {
        const res = await call(api.network.listShares({ server }))
        set((s) => ({
          network: {
            ...s.network,
            sharesByHost: {
              ...s.network.sharesByHost,
              [key]: { status: 'done', shares: res.shares }
            }
          }
        }))
      } catch (e) {
        set((s) => ({
          network: {
            ...s.network,
            sharesByHost: {
              ...s.network.sharesByHost,
              [key]: {
                status: 'error',
                shares: [],
                message: e instanceof IpcError ? e.message : String(e)
              }
            }
          }
        }))
      }
    },

    async openMapNetworkDrive() {
      try {
        await call(api.network.mapDriveDialog())
        await get().refreshDrivesNow()
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async openDisconnectNetworkDrive() {
      try {
        await call(api.network.disconnectDriveDialog())
        await get().refreshDrivesNow()
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async disconnectMappedDrive(path, opts) {
      const letter = /^([a-zA-Z]):/i.exec(path.replace(/\//g, '\\'))?.[1]?.toUpperCase() ?? '?'
      const drive = get().drives.find(
        (d) => d.path.replace(/[\\/]+$/, '').toUpperCase() === `${letter}:`
      )
      const remote = drive?.remotePath
      const force = opts?.force === true
      const msg = force
        ? `Force disconnect ${letter}:${remote ? ` (${remote})` : ''}?\n\nOpen files may be interrupted. The persistent mapping will be removed.`
        : `Disconnect ${letter}:${remote ? ` — ${remote}` : ''}?\n\nThis removes the persistent “Reconnect at sign-in” mapping so the letter no longer appears under Drives.`
      if (!window.confirm(msg)) return
      try {
        await call(api.network.disconnectMappedDrive({ path, force }))
        await get().refreshDrivesNow()
        get().notify(`Disconnected ${letter}:`)
      } catch (e) {
        if (e instanceof IpcError && e.code === 'busy' && !force) {
          if (
            window.confirm(
              `${letter}: is in use.\n\nForce disconnect anyway? Open files on that drive may fail.`
            )
          ) {
            await get().disconnectMappedDrive(path, { force: true })
          }
          return
        }
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    clearHistory(tabId) {
      const id = tabId ?? get().activeTabId
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab) return
      if (tab.back.length === 0 && tab.forward.length === 0) return
      updateTab(id, { back: [], forward: [] })
    },

    async goToHistoryEntry(entry, tabId) {
      const id = tabId ?? get().activeTabId
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab) return
      if (sameHistoryEntry(entry, currentLocation(tab))) return
      if (entry.kind === 'folder') {
        await get().navigate(entry.path, { tabId: id })
        return
      }
      await applyTabHistoryEntry(id, entry, {
        back: [...tab.back, currentLocation(tab)],
        forward: []
      })
    },

    async newTab(path, rootPath) {
      const s = get()
      const target = path ?? s.activeTab().path ?? s.settings.defaultNewTabPath ?? s.homePath
      const tab: Tab = {
        id: newTabId(),
        path: target,
        title: null,
        icon: defaultTabIcon(target, rootPath ?? null),
        viewMode: s.activeTab().viewMode,
        sort: { key: 'name', dir: 'asc' },
        back: [],
        forward: [],
        selected: [],
        scrollOffset: 0,
        rootPath: rootPath ?? null,
        treeExpanded: [],
        search: emptyTabSearch(s.settings.searchIndexedOnly)
      }
      const focusIdx = s.focusedPaneIndex
      const nextPanes = [...s.paneTabIds]
      while (nextPanes.length < s.viewLayout) nextPanes.push(null)
      nextPanes[focusIdx] = tab.id
      set({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        search: tab.search,
        paneTabIds: nextPanes.slice(0, s.viewLayout),
        focusedPaneIndex: focusIdx,
        selectionAnchor: null,
        focusedPath: null
      })
      flushSessionSave()
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
        treeExpanded: [...src.treeExpanded],
        search: {
          ...src.search,
          running: false,
          progress: null,
          gen: 0
        }
      }
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = [...s.tabs]
      tabs.splice(idx + 1, 0, tab)
      const focusIdx = s.focusedPaneIndex
      const nextPanes = [...s.paneTabIds]
      while (nextPanes.length < s.viewLayout) nextPanes.push(null)
      nextPanes[focusIdx] = tab.id
      set({
        tabs,
        activeTabId: tab.id,
        search: tab.search,
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
      const closing = s.tabs.find((t) => t.id === id)
      if (!closing) return
      clearFileViewScroll(id)
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      const tabIds = tabs.map((t) => t.id)
      const closedPane = s.paneTabIds.indexOf(id)
      const closedTabs: ClosedTabEntry[] = [
        {
          tab: tabToSessionTab(closing),
          paneIndex: closedPane >= 0 ? closedPane : null
        },
        ...s.closedTabs
      ].slice(0, MAX_CLOSED_TABS)
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
        closedTabs,
        search: tabs.find((t) => t.id === activeTabId)?.search ?? emptyTabSearch(),
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

    async reopenClosedTab(index = 0) {
      const s = get()
      if (index < 0 || index >= s.closedTabs.length) return
      const entry = s.closedTabs[index]!
      const closedTabs = s.closedTabs.filter((_, i) => i !== index)
      const tab = sessionTabToTab({ ...entry.tab, id: newTabId() })
      let paneTabIds = [...s.paneTabIds]
      while (paneTabIds.length < s.viewLayout) paneTabIds.push(null)
      let focusedPaneIndex = s.focusedPaneIndex
      const slot = entry.paneIndex
      const canReattach =
        slot != null && slot >= 0 && slot < s.viewLayout && paneTabIds[slot] == null
      if (canReattach) {
        paneTabIds[slot] = tab.id
        focusedPaneIndex = slot
      } else {
        paneTabIds[focusedPaneIndex] = tab.id
      }
      paneTabIds = paneTabIds.slice(0, s.viewLayout)
      const focus = focusFromSelection(tab.selected)
      set({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        closedTabs,
        search: tab.search,
        paneTabIds,
        focusedPaneIndex,
        selectionAnchor: focus.selectionAnchor,
        focusedPath: focus.focusedPath
      })
      scheduleSessionSave()
      await loadListing(tab.path, { tabId: tab.id })
    },

    clearClosedTabs() {
      if (get().closedTabs.length === 0) return
      set({ closedTabs: [] })
      scheduleSessionSave()
    },

    async activateTab(id) {
      if (get().recycleBin.active) get().closeRecycleBinView()
      flushPendingRename()
      const s = get()
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab) return
      const existingPane =
        s.paneTabIds[s.focusedPaneIndex] === id ? s.focusedPaneIndex : s.paneTabIds.indexOf(id)
      if (existingPane >= 0) {
        if (s.activeTabId === id && s.focusedPaneIndex === existingPane) return
        const focus = focusFromSelection(tab.selected)
        const listing = s.listingsByTabId[id]
        set({
          activeTabId: id,
          search: tab.search,
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
        paneTreeCollapsed: sanitizePaneTreeCollapsed(s.paneTreeCollapsed, mode),
        focusedPaneIndex,
        activeTabId: activeTabId || s.activeTabId,
        search: tab?.search ?? s.search,
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
      if (s.recycleBin.active && s.activeTabId !== tabId) get().closeRecycleBinView()
      const tab = s.tabs.find((t) => t.id === tabId)
      if (!tab) return
      const focus = focusFromSelection(tab.selected)
      const listing = s.listingsByTabId[tabId]
      set({
        focusedPaneIndex: index,
        activeTabId: tabId,
        search: tab.search,
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
      // One slot per tab — use duplicateTabIntoPane to show the same path in two panes.
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
      if (s.recycleBin.active) get().closeRecycleBinView()
      const focus = focusFromSelection(tab.selected)
      set({
        paneTabIds,
        focusedPaneIndex: paneIndex,
        activeTabId: tabId,
        search: tab.search,
        selectionAnchor: focus.selectionAnchor,
        focusedPath: focus.focusedPath,
        renamingPath: null,
        renameSource: null
      })
      scheduleSessionSave()
      await loadListing(tab.path, { tabId })
    },

    async duplicateTabIntoPane(paneIndex, sourceTabId, opts) {
      const s = get()
      if (paneIndex < 0 || paneIndex >= s.viewLayout) return
      const src = s.tabs.find((t) => t.id === sourceTabId)
      if (!src) return
      if (s.paneTabIds[paneIndex] === sourceTabId) {
        get().focusPane(paneIndex)
        return
      }
      // Normal drop = move/assign. Ctrl+drag = duplicate so both panes can show the path.
      if (!opts?.duplicate) {
        await get().assignTabToPane(paneIndex, sourceTabId)
        return
      }
      if (s.recycleBin.active) get().closeRecycleBinView()

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
        treeExpanded: [...src.treeExpanded],
        search: {
          ...src.search,
          running: false,
          progress: null,
          gen: 0
        }
      }
      const srcIdx = s.tabs.findIndex((t) => t.id === sourceTabId)
      const tabs = [...s.tabs]
      tabs.splice(srcIdx + 1, 0, tab)

      const nextPanes = [...s.paneTabIds]
      while (nextPanes.length < s.viewLayout) nextPanes.push(null)
      nextPanes[paneIndex] = tab.id

      set({
        tabs,
        activeTabId: tab.id,
        search: tab.search,
        paneTabIds: nextPanes.slice(0, s.viewLayout),
        focusedPaneIndex: paneIndex,
        selectionAnchor: null,
        focusedPath: null,
        renamingPath: null,
        renameSource: null
      })
      scheduleSessionSave()
      await loadListing(tab.path, { tabId: tab.id })
    },

    setPaneSplitCols(ratio) {
      set({ paneSplitCols: clampPaneRatio(ratio) })
      scheduleSessionSave()
    },

    setPaneSplitRows(ratio) {
      set({ paneSplitRows: clampPaneRatio(ratio) })
      scheduleSessionSave()
    },

    togglePaneTree(paneIndex) {
      const s = get()
      if (paneIndex < 0 || paneIndex >= s.viewLayout) return
      const next = sanitizePaneTreeCollapsed(s.paneTreeCollapsed, s.viewLayout)
      next[paneIndex] = !next[paneIndex]
      set({
        paneTreeCollapsed: next,
        splitters: { ...s.splitters, treeCollapsed: next[0] === true }
      })
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

    collapseAllTree() {
      const id = get().activeTabId
      if (!id) return
      updateTab(id, { treeExpanded: [] })
      set((s) => ({
        treeCollapseRequest: { tabId: id, rev: s.treeCollapseRequest.rev + 1 }
      }))
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
      flushSessionSave()
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
      viewOrderCache = null
      if (id === get().activeTabId) resortCurrentListing()
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
        const sorted = sortEntries(
          listing.entries,
          sort,
          currentListingFoldersFirst(listing.path)
        )
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

    async saveViewPreset(name) {
      const trimmed = name.trim().slice(0, 80)
      if (!trimmed) return
      const s = get()
      if (s.settings.viewPresets.length >= 30) {
        get().notify('At most 30 view presets', true)
        return
      }
      const tab = s.activeTab()
      const owning = resolveFolderView(tab.path, s.settings.folderViews)
      const id = `vp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      await get().applySettingsPatch({
        viewPresets: [
          ...s.settings.viewPresets,
          {
            id,
            name: trimmed,
            viewMode: owning?.viewMode ?? tab.viewMode,
            sort: owning?.sort ?? tab.sort,
            detailsColumns: owning?.detailsColumns ?? s.settings.detailsColumns,
            detailsNameWidth: owning?.detailsNameWidth ?? s.settings.detailsNameWidth,
            iconSizePx: s.settings.iconSizePx,
            foldersFirst: s.settings.foldersFirst
          }
        ]
      })
      get().notify(`Saved view preset: ${trimmed}`)
    },

    async applyViewPreset(id) {
      const s = get()
      const preset = s.settings.viewPresets.find((p) => p.id === id)
      if (!preset) return
      const tab = s.activeTab()
      const owning = resolveFolderView(tab.path, s.settings.folderViews)
      const detailsColumns = preset.detailsColumns.filter((c) => c.id !== 'folder') as Settings['detailsColumns']
      const extra = {
        detailsNameWidth: preset.detailsNameWidth,
        ...(preset.iconSizePx != null ? { iconSizePx: preset.iconSizePx } : {}),
        ...(preset.foldersFirst != null ? { foldersFirst: preset.foldersFirst } : {})
      }
      if (owning) {
        await get().applySettingsPatch({
          folderViews: patchFolderView(s.settings.folderViews, owning.path, {
            viewMode: preset.viewMode,
            sort: preset.sort,
            detailsColumns,
            detailsNameWidth: preset.detailsNameWidth
          }),
          ...extra
        })
      } else {
        get().setViewMode(preset.viewMode)
        get().setSort(preset.sort)
        await get().applySettingsPatch({
          detailsColumns,
          ...extra
        })
      }
      get().notify(`Applied view preset: ${preset.name}`)
    },

    async renameViewPreset(id, name) {
      const trimmed = name.trim().slice(0, 80)
      if (!trimmed) return
      const s = get()
      await get().applySettingsPatch({
        viewPresets: s.settings.viewPresets.map((p) => (p.id === id ? { ...p, name: trimmed } : p))
      })
    },

    async removeViewPreset(id) {
      const s = get()
      await get().applySettingsPatch({
        viewPresets: s.settings.viewPresets.filter((p) => p.id !== id)
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
          paneTreeCollapsed: s.paneTreeCollapsed,
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
            paneTreeCollapsed: s.paneTreeCollapsed,
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
        icon: t.icon ?? defaultTabIcon(t.path, t.rootPath),
        viewMode: t.viewMode,
        sort: t.sort,
        rootPath: t.rootPath,
        treeExpanded: t.treeExpanded,
        back: [],
        forward: [],
        selected: [],
        scrollOffset: 0,
        search: emptyTabSearch()
      }))
      const idx = Math.min(Math.max(0, layout.activeTabIndex), tabs.length - 1)
      const active = tabs[idx]!
      const viewLayout = coerceViewLayout(layout.viewLayout)
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
      get().closeRecycleBinView()
      flushPendingRename()
      set({
        tabs,
        activeTabId: active.id,
        search: active.search,
        splitters: { ...layout.splitters },
        viewLayout,
        paneTabIds,
        paneTreeCollapsed: sanitizePaneTreeCollapsed(
          layout.paneTreeCollapsed,
          viewLayout,
          layout.splitters.treeCollapsed === true
        ),
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
        dialogStack: [],
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
          focusedPath: focused === undefined ? get().focusedPath : focused,
          ...(paths.length > 0 ? { drivesOverview: false } : {})
        })
      }
    },

    requestFileListScrollTo(path) {
      set((s) => ({
        fileListScrollRequest: {
          path,
          gen: (s.fileListScrollRequest?.gen ?? 0) + 1
        }
      }))
    },

    clearFileListScrollRequest() {
      set({ fileListScrollRequest: null })
    },

    selectAll(tabId) {
      const s = get()
      const id = tabId ?? s.activeTabId
      const selected = selectablePathsForTab(s, id)
      updateTab(id, { selected })
      if (id === s.activeTabId) {
        set({
          selectionAnchor: selected[0] ?? null,
          focusedPath: selected[selected.length - 1] ?? null,
          ...(selected.length > 0 ? { drivesOverview: false } : {})
        })
      }
    },

    isAllSelected(tabId) {
      const s = get()
      return tabHasAllSelected(s, tabId ?? s.activeTabId)
    },

    toggleSelectAll(tabId) {
      const s = get()
      const id = tabId ?? s.activeTabId
      if (tabHasAllSelected(s, id)) {
        updateTab(id, { selected: [] })
        if (id === s.activeTabId) {
          set({ selectionAnchor: null, focusedPath: null })
        }
        return
      }
      get().selectAll(id)
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
      set({ treeFocusPath: path, ...(path ? { drivesOverview: false } : {}) })
    },

    showDrivesOverview() {
      const tabId = get().activeTabId
      set((s) => ({
        drivesOverview: true,
        treeFocusPath: null,
        selectionAnchor: null,
        focusedPath: null,
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, selected: [] } : t))
      }))
      void get().refreshDrivesNow()
    },

    async submitRename(newName) {
      const path = get().renamingPath
      if (!path) return

      // Drive roots: edit the volume label only (path stays `C:\`).
      if (isVolumeRootPath(path)) {
        set({ renamingPath: null, renameSource: null })
        const name = newName.trim()
        const prev = get().drives.find((d) => samePath(d.path, path))?.volumeName ?? ''
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

      const trimmed = newName.trim()
      const oldName = basename(path)
      if (!trimmed || trimmed === oldName) {
        set({ renamingPath: null, renameSource: null })
        return
      }
      const parent = parentOf(path)
      const dest = parent ? joinPath(parent, trimmed) : path
      // Don't rewrite Test2 → Test while Test is already a sibling — that aliases
      // both rows onto one path and the conflict revert then labels both Test2.
      const destOccupied = renameDestOccupied(get().listing.entries, path, dest)
      if (!destOccupied) applyListingRename(path, dest, trimmed)
      try {
        await releaseMediaLocks()
        const res = await withBusyFeedback('relocate', 'Renaming…', trimmed, () =>
          call(api.fs.rename({ path, newName: trimmed }))
        )
        recordUndo({
          kind: 'rename',
          from: path,
          to: res.path,
          label: oldName
        })
        if (!samePath(res.path, dest)) applyListingRename(dest, res.path, basename(res.path))
        notifyTreeMutation({
          renamed: [{ from: path, to: res.path }],
          reloadParents: parent ? [parent] : []
        })
        const rewrite = (p: string): string => rewritePathAfterRename(p, path, res.path)
        set((s) => ({
          mediaHold: false,
          tabs: s.tabs.map((t) => ({
            ...t,
            path: rewrite(t.path),
            rootPath: t.rootPath ? rewrite(t.rootPath) : null,
            back: t.back.map((e) => rewriteHistoryEntry(e, rewrite)),
            forward: t.forward.map((e) => rewriteHistoryEntry(e, rewrite)),
            selected: t.selected.map(rewrite),
            treeExpanded: t.treeExpanded.map(rewrite)
          }))
        }))
        const followPaths = [path, dest, res.path]
        const stillOnRenamedItem = (): boolean => {
          const s = get()
          const tab = s.tabs.find((t) => t.id === s.activeTabId)
          return renameShouldFollow({
            renamingPath: s.renamingPath,
            focusedPath: s.focusedPath,
            selected: tab?.selected ?? [],
            paths: followPaths
          })
        }
        // A late NAS save must not remount the list (or jump selection) while
        // another inline rename is already open.
        if (stillOnRenamedItem()) {
          await get().refresh()
          if (stillOnRenamedItem()) {
            get().setSelection([res.path], res.path, res.path)
            get().requestFileListScrollTo(res.path)
          }
        }
      } catch (e) {
        if (!destOccupied) {
          const stillAtSource = get().listing.entries.some((en) => samePath(en.path, path))
          if (stillAtSource) applyListingRename(path, path, oldName)
          else applyListingRename(dest, path, oldName)
        }
        set({ mediaHold: false })
        if (e instanceof IpcError && e.code === 'conflict') {
          openOpIssuesReview({
            op: 'rename',
            issues: [await nameConflictIssue(path, dest, e.message)],
            destinationDir: parent ?? undefined,
            doneCount: 0
          })
          return
        }
        reportOperationError('Rename failed', e)
      }
    },

    async applyPowerRename(items) {
      const pairs: UndoPathPair[] = []
      const skipped: string[] = []
      if (items.length === 0) return { pairs, skipped }

      // Detect collisions within this batch (same parent + same newName).
      const claimed = new Map<string, string>()
      const work: { path: string; newName: string }[] = []
      for (const item of items) {
        const parent = parentOf(item.path)
        if (!parent || !item.newName.trim() || item.newName === basename(item.path)) {
          skipped.push(basename(item.path))
          continue
        }
        const key = `${parent.toLowerCase()}\\${item.newName.toLowerCase()}`
        if (claimed.has(key)) {
          skipped.push(item.newName)
          continue
        }
        claimed.set(key, item.path)
        work.push(item)
      }

      if (work.length === 0) return { pairs, skipped }

      const issues: OpIssue[] = []
      await releaseMediaLocks()
      try {
        await withBusyFeedback(
          'relocate',
          'Renaming…',
          work.length === 1 ? work[0]!.newName : `${work.length} items`,
          async () => {
            for (const item of work) {
              try {
                const res = await call(api.fs.rename({ path: item.path, newName: item.newName }))
                pairs.push({ from: item.path, to: res.path })
              } catch (e) {
                if (e instanceof IpcError && e.code === 'conflict') {
                  const destParent = parentOf(item.path)
                  const dest = destParent ? joinPath(destParent, item.newName) : item.path
                  issues.push(await nameConflictIssue(item.path, dest, e.message))
                  continue
                }
                skipped.push(basename(item.path))
              }
            }
          }
        )
      } finally {
        if (get().mediaHold) set({ mediaHold: false })
      }

      if (pairs.length > 0) {
        recordUndo({
          kind: 'power-rename',
          pairs,
          label: pairs.length === 1 ? basename(pairs[0]!.to) : `${pairs.length} items`
        })
        const rewriteOne = (p: string): string => {
          for (const pair of pairs) {
            if (samePath(p, pair.from)) return pair.to
            if (isUnderPath(p, pair.from)) return pair.to + p.slice(pair.from.length)
          }
          return p
        }
        notifyTreeMutation({
          removed: pairs.map((p) => p.from),
          reloadParents: parentsOfPaths(pairs.flatMap((p) => [p.from, p.to]))
        })
        set((s) => ({
          tabs: s.tabs.map((t) => ({
            ...t,
            path: rewriteOne(t.path),
            rootPath: t.rootPath ? rewriteOne(t.rootPath) : null,
            back: t.back.map((e) => rewriteHistoryEntry(e, rewriteOne)),
            forward: t.forward.map((e) => rewriteHistoryEntry(e, rewriteOne)),
            selected: t.selected.map(rewriteOne),
            treeExpanded: t.treeExpanded.map(rewriteOne)
          }))
        }))
        await get().refresh()
        const selected = pairs.map((p) => p.to)
        get().setSelection(selected, selected[0], selected[0])
        if (selected[0]) get().requestFileListScrollTo(selected[0])
      }

      if (issues.length > 0) {
        const destDir = parentOf(issues[0]!.dest ?? issues[0]!.source) ?? undefined
        openOpIssuesReview({
          op: 'rename',
          issues,
          destinationDir: destDir,
          doneCount: pairs.length
        })
      }

      return { pairs, skipped }
    },

    async undoPowerRenameApply(pairs) {
      if (pairs.length === 0) return
      const reverse = pairs.map((p) => ({ from: p.to, to: p.from }))
      await releaseMediaLocks()
      try {
        await withBusyFeedback(
          'relocate',
          'Undoing rename…',
          pairs.length === 1 ? basename(pairs[0]!.from) : `${pairs.length} items`,
          () => call(api.fs.relocate({ pairs: reverse }))
        )
        notifyTreeMutation({
          removed: reverse.map((p) => p.from),
          reloadParents: parentsOfPaths(reverse.flatMap((p) => [p.from, p.to]))
        })
        const rewriteOne = (p: string): string => {
          for (const pair of pairs) {
            if (samePath(p, pair.to)) return pair.from
            if (isUnderPath(p, pair.to)) return pair.from + p.slice(pair.to.length)
          }
          return p
        }
        set((s) => ({
          mediaHold: false,
          tabs: s.tabs.map((t) => ({
            ...t,
            path: rewriteOne(t.path),
            rootPath: t.rootPath ? rewriteOne(t.rootPath) : null,
            back: t.back.map((e) => rewriteHistoryEntry(e, rewriteOne)),
            forward: t.forward.map((e) => rewriteHistoryEntry(e, rewriteOne)),
            selected: t.selected.map(rewriteOne),
            treeExpanded: t.treeExpanded.map(rewriteOne)
          }))
        }))
        // Drop matching undo entry if it is still on top (dialog Undo already reversed).
        const stack = get().undoStack
        const top = stack[stack.length - 1]
        if (
          top?.kind === 'power-rename' &&
          top.pairs.length === pairs.length &&
          top.pairs.every(
            (p, i) => samePath(p.from, pairs[i]!.from) && samePath(p.to, pairs[i]!.to)
          )
        ) {
          set({ undoStack: stack.slice(0, -1) })
        }
        await get().refresh()
        const selected = pairs.map((p) => p.from)
        get().setSelection(selected, selected[0], selected[0])
      } catch (e) {
        set({ mediaHold: false })
        reportOperationError('Undo Power Rename failed', e)
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
        const trimmed = name.trim()
        if (!trimmed) return
        set({ dialog: null })
        try {
          const res = await call(api.fs.createFile({ parent, name: trimmed }))
          recordUndo({ kind: 'create', paths: [res.path], label: trimmed })
          await get().refresh()
          get().setSelection([res.path], res.path, res.path)
          get().startRename(res.path)
          return
        } catch (e) {
          if (!(e instanceof IpcError && e.code === 'conflict')) throw e
        }
        // Name is taken — create a stub, then rename so the D18 review applies.
        const { ext } = splitBaseExt(trimmed)
        const stub = await uniqueChildName(parent, 'New file', ext)
        const res = await call(api.fs.createFile({ parent, name: stub }))
        recordUndo({ kind: 'create', paths: [res.path], label: stub })
        await get().refresh()
        get().setSelection([res.path], res.path, res.path)
        get().startRename(res.path)
        await get().submitRename(trimmed)
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

    async createFromTemplate(templateId, destDir) {
      try {
        if (!samePath(destDir, get().activeTab().path)) await get().navigate(destDir)
        const res = await call(api.templates.instantiate({ id: templateId, destDir }))
        recordUndo({ kind: 'create', paths: [res.path], label: basename(res.path) })
        await get().refresh()
        get().setSelection([res.path], res.path, res.path)
        get().startRename(res.path)
      } catch (e) {
        reportOperationError('Template failed', e)
      }
    },

    async importFileTemplate() {
      try {
        const res = await call(api.templates.import())
        if (res.cancelled) return null
        const settings = await call(api.settings.get())
        set({ settings })
        return res.template.id
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
        return null
      }
    },

    async replaceFileTemplate(templateId) {
      try {
        const res = await call(api.templates.replace({ id: templateId }))
        if (res.cancelled) return
        const settings = await call(api.settings.get())
        set({ settings })
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async duplicateFileTemplate(templateId) {
      try {
        const template = await call(api.templates.duplicate({ id: templateId }))
        const settings = await call(api.settings.get())
        set({ settings })
        return template.id
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
        return null
      }
    },

    async deleteFileTemplate(templateId) {
      try {
        await call(api.templates.delete({ id: templateId }))
        const settings = await call(api.settings.get())
        set({ settings })
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
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
      await get().pasteInto(get().activeTab().path)
    },

    async pasteInto(destDir) {
      if (get().recycleBin.active) return
      if (isRemoteLocation(destDir)) {
        get().notify('Cannot paste into a remote folder from the clipboard', true)
        return
      }
      const clip = await resolveClipboard(get)
      if (clip && clip.paths.length > 0) {
        await get().performTransfer(
          clip.mode === 'cut' ? 'move' : 'copy',
          clip.paths,
          destDir,
          clip.mode === 'cut'
        )
        return
      }
      if (get().settings.pasteNonFileClipboard === false) return
      try {
        const peek = await call(api.shell.clipboardPeek())
        const format = defaultPasteFormat(peek.kind)
        if (!format) return
        await get().pasteClipboardAs(destDir, format)
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async pasteClipboardAs(destDir, format, name) {
      if (get().recycleBin.active) return
      if (isRemoteLocation(destDir)) {
        get().notify('Cannot paste into a remote folder from the clipboard', true)
        return
      }
      try {
        const res = await call(api.shell.clipboardWriteFile({ destDir, format, name }))
        recordUndo({ kind: 'create', paths: [res.path], label: basename(res.path) })
        if (!samePath(destDir, get().activeTab().path)) await get().navigate(destDir)
        else await get().refresh()
        get().setSelection([res.path], res.path, res.path)
        get().notify(`Created ${basename(res.path)}`)
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async performTransfer(op, sources, destinationDir, clearCutAfter = false) {
      // Moving into the same folder is a no-op.
      const effective =
        op === 'move'
          ? sources.filter((p) => !samePath(parentOf(p) ?? '', destinationDir))
          : sources
      if (effective.length === 0) return false
      try {
        // Same-folder copy (Ctrl+C / Ctrl+V in place): Explorer-style Keep both —
        // auto-number (`name (2).ext`) with no dual-compare dialog; select the new copies.
        const sameFolderCopy =
          op === 'copy' &&
          effective.every((p) => {
            const parent = parentOf(p)
            return parent != null && samePath(parent, destinationDir)
          })
        if (sameFolderCopy) {
          await executeTransfer(op, effective, destinationDir, 'rename', clearCutAfter)
          return true
        }

        await executeTransfer(op, effective, destinationDir, 'fail', clearCutAfter)
        return true
      } catch (e) {
        reportOperationError(op === 'move' ? 'Move failed' : 'Copy failed', e)
        return false
      }
    },

    async createShortcutsHere(sources, destinationDir) {
      if (sources.length === 0) return
      const label = sources.length === 1 ? basename(sources[0]!) : `${sources.length} items`
      try {
        const res = await withBusyFeedback('relocate', 'Creating shortcuts…', label, () =>
          call(api.fs.createShortcuts({ sources, destinationDir }))
        )
        recordUndo({
          kind: 'create',
          paths: res.created,
          label:
            res.created.length === 1 ? basename(res.created[0]!) : `${res.created.length} shortcuts`
        })
        // Refresh every visible pane — dest may be a non-focused view.
        await get().refresh()
        get().notify(
          res.created.length === 1 ? 'Created shortcut' : `Created ${res.created.length} shortcuts`
        )
      } catch (e) {
        reportOperationError('Create shortcut failed', e)
      }
    },

    async createLink(source, destDir, type, name) {
      try {
        const res = await call(api.fs.createLink({ source, destDir, type, name }))
        recordUndo({ kind: 'create', paths: [res.path], label: basename(res.path) })
        if (!samePath(destDir, get().activeTab().path)) await get().navigate(destDir)
        else await get().refresh()
        get().setSelection([res.path], res.path, res.path)
        get().notify(`Created link ${basename(res.path)}`)
      } catch (e) {
        reportOperationError('Create link failed', e)
      }
    },

    async compressToZip(paths) {
      const selected = paths && paths.length > 0 ? paths : get().activeTab().selected
      if (selected.length === 0) return
      const label = selected.length === 1 ? basename(selected[0]!) : `${selected.length} items`
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
      const selected = paths && paths.length > 0 ? paths : get().activeTab().selected
      if (selected.length === 0) return
      const label = selected.length === 1 ? basename(selected[0]!) : `${selected.length} archives`
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
            const r = await runTransfer(dialog.op, replaceSources, dialog.destinationDir, 'replace')
            copied += r.copied
            moved += r.moved
            skipped += r.skipped
            copyPaths.push(...r.copyPaths)
            movePairs.push(...r.movePairs)
          }
          if (renameSources.length > 0) {
            const r = await runTransfer(dialog.op, renameSources, dialog.destinationDir, 'rename')
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

    async resolveOpIssues(items) {
      const dialog = get().dialog
      if (!dialog || dialog.kind !== 'op-issues') return
      set({ dialog: null })
      if (dialog.op === 'trash' || dialog.op === 'delete') await releaseMediaLocks()
      if (items === null || items.length === 0) {
        clearMediaHold()
        return
      }

      const decided = new Set(items.map((it) => issueKey(it)))
      const leftover = dialog.issues.filter((it) => !decided.has(issueKey(it)))

      try {
        const busyKind =
          dialog.op === 'copy' || dialog.op === 'move'
            ? dialog.op
            : dialog.op === 'rename'
              ? 'relocate'
              : dialog.op === 'trash'
                ? 'trash'
                : 'delete'
        const busyLabel =
          dialog.op === 'copy'
            ? 'Copying…'
            : dialog.op === 'move'
              ? 'Moving…'
              : dialog.op === 'rename'
                ? 'Renaming…'
                : dialog.op === 'trash'
                  ? 'Moving to Recycle Bin…'
                  : 'Deleting…'
        const res = await withBusyFeedback(busyKind, busyLabel, `${items.length} items`, () =>
          call(
            api.fs.resolveIssues({
              op: dialog.op,
              destinationDir: dialog.destinationDir,
              items
            })
          )
        )

        let done = dialog.doneCount
        if (res.copied.length > 0) {
          recordUndo({
            kind: 'copy',
            paths: res.copied,
            label: basename(res.copied[0]!)
          })
          done += res.copied.length
          notifyTreeReload(dialog.destinationDir ? [dialog.destinationDir] : [])
        }
        if (res.moves.length > 0) {
          if (dialog.op === 'rename') {
            recordUndo(
              res.moves.length === 1
                ? {
                    kind: 'rename',
                    from: res.moves[0]!.from,
                    to: res.moves[0]!.to,
                    label: basename(res.moves[0]!.from)
                  }
                : {
                    kind: 'power-rename',
                    pairs: res.moves,
                    label:
                      res.moves.length === 1
                        ? basename(res.moves[0]!.to)
                        : `${res.moves.length} items`
                  }
            )
            notifyTreeMutation({
              renamed: res.moves,
              reloadParents: parentsOfPaths(res.moves.flatMap((p) => [p.from, p.to]))
            })
            const rewriteOne = (p: string): string => {
              for (const pair of res.moves) {
                if (samePath(p, pair.from)) return pair.to
                if (isUnderPath(p, pair.from)) return pair.to + p.slice(pair.from.length)
              }
              return p
            }
            set((s) => ({
              tabs: s.tabs.map((t) => ({
                ...t,
                path: rewriteOne(t.path),
                rootPath: t.rootPath ? rewriteOne(t.rootPath) : null,
                back: t.back.map((e) => rewriteHistoryEntry(e, rewriteOne)),
                forward: t.forward.map((e) => rewriteHistoryEntry(e, rewriteOne)),
                selected: t.selected.map(rewriteOne),
                treeExpanded: t.treeExpanded.map(rewriteOne)
              }))
            }))
          } else {
            recordUndo({
              kind: 'move',
              pairs: res.moves,
              label: basename(res.moves[0]!.to)
            })
            const movedSrc = res.moves.map((p) => p.from)
            pruneListingRemoved(movedSrc)
            notifyTreeMutation({
              removed: movedSrc,
              reloadParents: dialog.destinationDir ? [dialog.destinationDir] : []
            })
          }
          done += res.moves.length
        }
        if (res.trashed.length > 0) {
          recordUndo({
            kind: 'trash',
            paths: res.trashed,
            label: basename(res.trashed[0]!)
          })
          done += res.trashed.length
          await afterPathsRemoved(res.trashed)
        }
        if (res.deleted.length > 0) {
          done += res.deleted.length
          await afterPathsRemoved(res.deleted)
        }

        const remaining = [...leftover, ...(res.issues ?? [])]
        if (remaining.length > 0) {
          get().notify(
            `${done.toLocaleString()} done · ${remaining.length.toLocaleString()} need review`
          )
          openOpIssuesReview({
            op: dialog.op,
            issues: remaining,
            destinationDir: dialog.destinationDir,
            clearCutAfter: dialog.clearCutAfter,
            doneCount: done
          })
        } else {
          const verb =
            dialog.op === 'copy'
              ? 'Copied'
              : dialog.op === 'move'
                ? 'Moved'
                : dialog.op === 'rename'
                  ? 'Renamed'
                  : dialog.op === 'trash'
                    ? 'Moved to Recycle Bin'
                    : 'Deleted'
          get().notify(`${verb} ${done.toLocaleString()}`)
        }
        await get().refresh()
      } catch (e) {
        openOpIssuesReview({
          op: dialog.op,
          issues: leftover.length > 0 ? leftover : dialog.issues,
          destinationDir: dialog.destinationDir,
          clearCutAfter: dialog.clearCutAfter,
          doneCount: dialog.doneCount
        })
        reportOperationError('Could not apply review decisions', e)
      }
    },

    async deleteSelection(permanent, paths) {
      const s = get()
      if (s.recycleBin.active) {
        // In the bin: Del / Shift+Del permanently remove from the Recycle Bin.
        get().deleteFromRecycleBinView(paths)
        return
      }
      let target = (paths ?? s.activeTab().selected).filter((p) => !isVolumeRootPath(p))
      if (target.length === 0) return
      // NAS devices commonly expose their server-side recycle bin as an
      // `@Recycle` directory. Check path segments rather than Windows path
      // types so this also works for POSIX SMB mounts on Linux.
      const isNasRecyclePath = (p: string): boolean => {
        if (isRemoteLocation(p)) return false
        return p
          .replace(/\\/g, '/')
          .split('/')
          .some((part) => part.toLowerCase() === '@recycle')
      }
      const nasRecycleRoots = target.filter((p) => {
        return basename(p).toLowerCase() === '@recycle' && isNasRecyclePath(p)
      })
      if (nasRecycleRoots.length > 0) {
        try {
          const contents = await Promise.all(
            nasRecycleRoots.map(async (root) => {
              const res = await call(api.fs.list({ path: root, includeHidden: true }))
              return { root, paths: res.entries.map((entry) => entry.path) }
            })
          )
          const byRoot = new Map(contents.map((item) => [item.root, item.paths]))
          target = target.flatMap((p) => byRoot.get(p) ?? [p])
        } catch (e) {
          reportOperationError('Could not empty NAS Recycle Bin', e)
          return
        }
        if (target.length === 0) {
          get().notify('NAS Recycle Bin is already empty')
          return
        }
      }
      const deletingNasRecycleContents = target.some(
        (p) => isNasRecyclePath(p) && basename(p).toLowerCase() !== '@recycle'
      )
      // Linux mounts SMB/NFS shares as regular POSIX paths. Ask the main
      // process for the filesystem type so mounted NAS paths use the same
      // permanent-delete confirmation as Windows UNC/mapped drives.
      let mountedNetworkPath = false
      if (s.platform !== 'win32') {
        const pathsToCheck = [...new Set([s.activeTab().path, target[0]!])]
        const networkFlags = await Promise.all(
          pathsToCheck.map(async (p) => {
            try {
              return (await call(api.fs.stat({ path: p }))).isNetwork
            } catch {
              return false
            }
          })
        )
        mountedNetworkPath = networkFlags.some(Boolean)
      }
      // Windows does not provide a client Recycle Bin for UNC shares, mapped
      // network drives, or the app's remote repository paths. Match Explorer's
      // behavior there by using the permanent-delete flow with confirmation.
      const remoteDeleteFallback = target.some((p) => {
        if (isRemoteLocation(p) || parseUnc(p)) return true
        const drive = driveOf(p)
        return (
          drive !== null &&
          s.drives.some((d) => driveOf(d.path) === drive && d.driveType === 'remote')
        )
      }) || mountedNetworkPath
      const effectivePermanent = permanent || remoteDeleteFallback || deletingNasRecycleContents
      const rootHits = tabsWhoseRootIsDeleted(s.tabs, target)
      if (rootHits.length > 0) {
        const prompt = tabRootDeletePrompt(rootHits, effectivePermanent)
        const ok = await get().askConfirm({
          title: prompt.title,
          message: prompt.message,
          confirmLabel: 'Delete',
          danger: true
        })
        if (!ok) return
      }
      if (!effectivePermanent) {
        try {
          // Select the survivor first so the preview keeps painting while we trash.
          const autoSelectedPath = selectAfterDelete(target)
          await releaseMediaLocks()
          const res = await withBusyFeedback(
            'trash',
            'Moving to Recycle Bin…',
            target.length === 1 ? basename(target[0]!) : `${target.length} items`,
            () => call(api.fs.trash({ paths: target }))
          )
          if (res.trashed.length > 0) {
            recordUndo({
              kind: 'trash',
              paths: res.trashed,
              label: basename(res.trashed[0]!)
            })
            await afterPathsRemoved(res.trashed, {
              expectedSelection: autoSelectedPath ? [autoSelectedPath] : []
            })
          }
          if (res.issues.length > 0) {
            get().notify(
              `Moved ${res.trashed.length.toLocaleString()} · ${res.issues.length.toLocaleString()} need review`
            )
            openOpIssuesReview({
              op: 'trash',
              issues: res.issues,
              doneCount: res.trashed.length
            })
          } else {
            get().notify(
              `Moved ${res.trashed.length} item${res.trashed.length > 1 ? 's' : ''} to Recycle Bin`
            )
          }
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
      const needsConfirm =
        remoteDeleteFallback || target.length > 1 || anyDir || s.settings.confirmPermanentDeleteAlways
      if (needsConfirm && rootHits.length === 0) {
        set({ dialog: { kind: 'confirm-permanent-delete', paths: target } })
      } else {
        await doPermanentDelete(target)
      }

      async function doPermanentDelete(toDelete: string[]): Promise<void> {
        await runPermanentDelete(toDelete)
      }
    },

    async confirmPermanentDelete(confirmed) {
      const dialog = get().dialog
      set({ dialog: null })
      if (!dialog || dialog.kind !== 'confirm-permanent-delete' || !confirmed) return
      await runPermanentDelete(dialog.paths)
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
      const remote = isRemoteLocation(path)
      const label = basename(path) || path
      if (remote) {
        set({
          remoteBusyDialog: {
            status: 'working',
            title: 'Opening',
            message: `Opening ${label}…`
          }
        })
      }
      try {
        const res = await call(api.shell.openPath({ path }))
        if (remote) {
          if (!res.opened) {
            set({
              remoteBusyDialog: {
                status: 'error',
                title: 'Open failed',
                message: `Could not open ${label}.`,
                detail: res.message ?? 'Unknown error'
              }
            })
            return
          }
          set({ remoteBusyDialog: null })
          return
        }
        if (!res.opened) get().notify(res.message ?? 'Could not open file', true)
      } catch (e) {
        const detail = e instanceof IpcError ? e.message : String(e)
        if (remote) {
          set({
            remoteBusyDialog: {
              status: 'error',
              title: 'Open failed',
              message: `Could not open ${label}.`,
              detail
            }
          })
          return
        }
        get().notify(detail, true)
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
      get().requestFileListScrollTo(filePath)
    },

    async openFileInNewTab(filePath) {
      let isDir = false
      try {
        const st = await call(api.fs.stat({ path: filePath }))
        isDir = st.kind === 'dir'
      } catch {
        /* treat as file */
      }
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
      get().requestFileListScrollTo(filePath)
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
        set({ imageEditor: null, imageVersionPreview: null })
        get().slideshowInvalidateImage(path)
        await api.meta.invalidate({ paths: [path] })
        get().bumpColumnMeta(path)
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
          api.fs.saveEditedImageAs({
            dataBase64,
            defaultPath,
            sourcePath
          })
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

    async askConfirm(opts) {
      if (confirmResolve) {
        confirmResolve(false)
        confirmResolve = null
      }
      return await new Promise<boolean>((resolve) => {
        confirmResolve = resolve
        set({
          dialog: {
            kind: 'confirm',
            title: opts.title,
            message: opts.message,
            confirmLabel: opts.confirmLabel,
            danger: opts.danger
          }
        })
      })
    },

    resolveConfirm(confirmed) {
      set({ dialog: null })
      const r = confirmResolve
      confirmResolve = null
      r?.(confirmed)
    },

    async askMediaKind(opts) {
      if (mediaKindResolve) {
        mediaKindResolve(null)
        mediaKindResolve = null
      }
      return await new Promise<'movie' | 'show' | null>((resolve) => {
        mediaKindResolve = resolve
        set({
          dialog: {
            kind: 'media-kind',
            title: opts.title,
            message: opts.message
          }
        })
      })
    },

    resolveMediaKind(choice) {
      set({ dialog: null })
      const r = mediaKindResolve
      mediaKindResolve = null
      r?.(choice)
    },

    async askMediaPick(opts) {
      if (mediaPickResolve) {
        mediaPickResolve(null)
        mediaPickResolve = null
      }
      return await new Promise<MediaPickResult | null>((resolve) => {
        mediaPickResolve = resolve
        set({
          dialog: {
            kind: 'media-pick',
            title: opts.title,
            message: opts.message,
            candidates: opts.candidates
          }
        })
      })
    },

    resolveMediaPick(choice) {
      set({ dialog: null })
      const r = mediaPickResolve
      mediaPickResolve = null
      r?.(choice)
    },

    async askMediaName(opts) {
      if (mediaNameResolve) {
        mediaNameResolve(null)
        mediaNameResolve = null
      }
      return await new Promise<string | null>((resolve) => {
        mediaNameResolve = resolve
        set({
          dialog: {
            kind: 'media-name',
            title: opts.title,
            message: opts.message,
            fileName: opts.fileName,
            suggested: opts.suggested
          }
        })
      })
    },

    resolveMediaName(name) {
      set({ dialog: null })
      const r = mediaNameResolve
      mediaNameResolve = null
      r?.(name)
    },

    setImageVersionPreview(preview) {
      set({ imageVersionPreview: preview })
    },

    async revertImageOriginal(path) {
      const ok = await get().askConfirm({
        title: 'Revert to original',
        message:
          'Delete all in-app edit versions and show the pristine original? Other alternate streams are kept.',
        confirmLabel: 'Revert',
        danger: true
      })
      if (!ok) return
      await releaseMediaLocks()
      try {
        await call(api.fs.revertImageOriginal({ path }))
        get().notify('Reverted to original')
        set({ imageVersionPreview: null })
        get().slideshowInvalidateImage(path)
        await api.meta.invalidate({ paths: [path] })
        get().bumpColumnMeta(path)
        await get().refresh()
        set({ mediaHold: false })
      } catch (e) {
        set({ mediaHold: false })
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async dropImageVersion(path, ver) {
      const ok = await get().askConfirm({
        title: 'Drop version',
        message: `Permanently drop Version ${ver}? Remaining versions will be renumbered.`,
        confirmLabel: 'Drop',
        danger: true
      })
      if (!ok) return
      await releaseMediaLocks()
      try {
        await call(api.fs.dropImageVersion({ path, ver }))
        get().notify(`Dropped Version ${ver}`)
        set({ imageVersionPreview: null })
        get().slideshowInvalidateImage(path)
        await api.meta.invalidate({ paths: [path] })
        get().bumpColumnMeta(path)
        await get().refresh()
        set({ mediaHold: false })
      } catch (e) {
        set({ mediaHold: false })
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async commitImageVersion(path) {
      let tipVer = 1
      try {
        const st = await call(api.fs.imageEditState({ path }))
        tipVer = st.tipVer || st.versionCount || 1
      } catch {
        /* use 1 */
      }
      const ok = await get().askConfirm({
        title: 'Commit changes',
        message: `Make Version ${tipVer} the new original and discard version history?`,
        confirmLabel: 'Commit',
        danger: true
      })
      if (!ok) return
      await releaseMediaLocks()
      try {
        const res = await call(api.fs.commitImageVersion({ path }))
        get().notify('Committed as new original')
        set({ imageVersionPreview: null })
        get().slideshowInvalidateImage(path)
        await api.meta.invalidate({ paths: [res.path] })
        get().bumpColumnMeta(res.path)
        await get().refresh()
        get().setSelection([res.path], res.path, res.path)
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

    async openCommandLineHere(path, opts) {
      try {
        await call(api.shell.openCommandLine({ path, elevated: opts?.elevated === true }))
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async changeFolderIcon(folderPath) {
      try {
        const pick = await call(
          api.slideshow.pickOpenFile({
            title: 'Choose folder icon',
            defaultPath: folderPath,
            filters: [{ name: 'Icon files', extensions: ['ico'] }]
          })
        )
        if (!pick.path) return
        await call(api.fs.setFolderIcon({ path: folderPath, iconPath: pick.path }))
        window.dispatchEvent(
          new CustomEvent('mfe-shell-icon-invalidate', {
            detail: { path: folderPath.toLowerCase() }
          })
        )
        get().notify(`Icon set for ${basename(folderPath)}`)
        await get().refresh()
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
      if (!dialog) return
      if (
        (dialog.kind === 'script-manager' ||
          dialog.kind === 'script-run' ||
          dialog.kind === 'script-generate') &&
        !get().settings.scripts?.enabled
      ) {
        get().notify('Enable scripting in Settings → Scripting and AI', true)
        return
      }
      const cur = get().dialog
      if (cur && shouldPushDialog(cur.kind, dialog.kind)) {
        set({ dialog, dialogStack: [...get().dialogStack, cur] })
        return
      }
      set({ dialog })
    },

    closeDialog() {
      const cur = get().dialog
      const stack = get().dialogStack
      if (cur && shouldPopStackedDialog(cur.kind) && stack.length > 0) {
        set({ dialog: stack[stack.length - 1]!, dialogStack: stack.slice(0, -1) })
        return
      }
      set({ dialog: null, dialogStack: [] })
    },

    openContextMenu(menu) {
      set({ contextMenu: menu })
    },

    closeContextMenu() {
      set({ contextMenu: null })
    },

    async runContextMenuCommand(commandId, paths) {
      if (paths.length === 0) return
      const cm = get().settings.contextMenu
      const cmd =
        cm.files.find((c) => c.id === commandId) ?? cm.folders.find((c) => c.id === commandId)
      if (!cmd || !cmd.enabled) {
        get().notify('Command not found or disabled', true)
        return
      }
      try {
        const args = expandArgsTemplate(cmd.argsTemplate, paths)
        await call(api.shell.exec({ executable: cmd.executable, args }))
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async runDiscoveredContextMenuVerb(verbId, paths) {
      if (paths.length === 0) return
      const disc = get().settings.contextMenu.discovered
      if (!disc?.enabledIds.includes(verbId)) {
        get().notify('Command not found or disabled', true)
        return
      }
      const verb = disc.verbs.find((v) => v.id === verbId)
      if (!verb?.supported || !verb.executable || !verb.argsTemplate) {
        get().notify('Command not found or disabled', true)
        return
      }
      try {
        const args = expandArgsTemplate(verb.argsTemplate, paths)
        await call(api.shell.exec({ executable: verb.executable, args }))
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async setDevGateEnable(enable) {
      try {
        const status = await call(api.app.setDevGateEnable({ enable }))
        set({
          devGateActive: status.active === true,
          devGatePresent: status.present === true,
          devGateEnable: status.enable === true
        })
        if (!status.active && get().dialog?.kind === 'compiled-lists-config') {
          get().closeDialog()
        }
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async applySettingsPatch(patch) {
      const prev = get().settings
      const mergedPatch: SettingsPatch = { ...patch }
      if (patch.slideshow) {
        mergedPatch.slideshow = {
          ...prev.slideshow,
          ...patch.slideshow
        }
      }
      if (patch.networkDiscovery) {
        mergedPatch.networkDiscovery = {
          ...prev.networkDiscovery,
          ...patch.networkDiscovery
        }
      }
      if (patch.remoteRepos) {
        mergedPatch.remoteRepos = {
          ...prev.remoteRepos,
          ...patch.remoteRepos
        }
      }
      if (patch.mediaMetadata) {
        mergedPatch.mediaMetadata = {
          ...prev.mediaMetadata,
          ...patch.mediaMetadata
        }
      }
      if (patch.scripts) {
        mergedPatch.scripts = {
          ...prev.scripts,
          ...patch.scripts,
          interpreterOverrides: {
            ...prev.scripts.interpreterOverrides,
            ...patch.scripts.interpreterOverrides
          }
        }
      }
      if (patch.ai) {
        const { providers, ...aiRest } = patch.ai
        mergedPatch.ai = {
          ...prev.ai,
          ...aiRest
        }
        if (providers !== undefined) {
          mergedPatch.ai.providers = providers
        } else {
          delete mergedPatch.ai.providers
        }
      }
      if (patch.contextMenu) {
        mergedPatch.contextMenu = {
          ...prev.contextMenu,
          ...patch.contextMenu,
          files: patch.contextMenu.files ?? prev.contextMenu.files,
          folders: patch.contextMenu.folders ?? prev.contextMenu.folders,
          hiddenBuiltins: patch.contextMenu.hiddenBuiltins ?? prev.contextMenu.hiddenBuiltins,
          builtinLayout: patch.contextMenu.builtinLayout ?? prev.contextMenu.builtinLayout,
          discovered: patch.contextMenu.discovered ?? prev.contextMenu.discovered
        }
      }
      // Optimistic update so toggles don’t snap back while IPC runs.
      set((s) => {
        const slideshowActive = s.slideshow.active != null
        let slideshow = mergedPatch.slideshow
          ? { ...s.settings.slideshow, ...mergedPatch.slideshow }
          : s.settings.slideshow
        // While playing, keep the huge image-list array out of reactive settings
        // (disk still has it; session cache is parked in slideshowPlayHeap).
        if (slideshowActive && slideshow.imageListCache.length > 0) {
          slideshow = { ...slideshow, imageListCache: [] }
        }
        return {
        settings: {
          ...s.settings,
          ...mergedPatch,
          slideshow,
          networkDiscovery: mergedPatch.networkDiscovery
            ? { ...s.settings.networkDiscovery, ...mergedPatch.networkDiscovery }
            : s.settings.networkDiscovery,
          remoteRepos: mergedPatch.remoteRepos
            ? { ...s.settings.remoteRepos, ...mergedPatch.remoteRepos }
            : s.settings.remoteRepos,
          mediaMetadata: mergedPatch.mediaMetadata
            ? { ...s.settings.mediaMetadata, ...mergedPatch.mediaMetadata }
            : s.settings.mediaMetadata,
          scripts: mergedPatch.scripts
            ? {
                ...s.settings.scripts,
                ...mergedPatch.scripts,
                interpreterOverrides: {
                  ...s.settings.scripts.interpreterOverrides,
                  ...mergedPatch.scripts.interpreterOverrides
                }
              }
            : s.settings.scripts,
          ai: mergedPatch.ai
            ? {
                ...s.settings.ai,
                ...mergedPatch.ai,
                providers: mergedPatch.ai.providers ?? s.settings.ai.providers
              }
            : s.settings.ai,
          contextMenu: mergedPatch.contextMenu
            ? {
                ...s.settings.contextMenu,
                ...mergedPatch.contextMenu,
                files: mergedPatch.contextMenu.files ?? s.settings.contextMenu.files,
                folders: mergedPatch.contextMenu.folders ?? s.settings.contextMenu.folders,
                hiddenBuiltins:
                  mergedPatch.contextMenu.hiddenBuiltins ?? s.settings.contextMenu.hiddenBuiltins,
                builtinLayout:
                  mergedPatch.contextMenu.builtinLayout ?? s.settings.contextMenu.builtinLayout,
                discovered: mergedPatch.contextMenu.discovered ?? s.settings.contextMenu.discovered
              }
            : s.settings.contextMenu
        },
        ...(typeof patch.searchIndexedOnly === 'boolean'
          ? { search: { ...s.search, indexedOnly: patch.searchIndexedOnly } }
          : {})
      }
      })
      if (patch.networkDiscovery) {
        syncNetworkDiscoveryPoll()
      }
      try {
        const settings = await call(api.settings.set(mergedPatch))
        set((s) => {
          let nextSettings = settings
          if (s.slideshow.active != null && nextSettings.slideshow.imageListCache.length > 0) {
            nextSettings = {
              ...nextSettings,
              slideshow: { ...nextSettings.slideshow, imageListCache: [] }
            }
          }
          return {
          settings: nextSettings,
          ...(typeof patch.searchIndexedOnly === 'boolean'
            ? { search: { ...s.search, indexedOnly: settings.searchIndexedOnly } }
            : {})
        }
        })
        if (patch.networkDiscovery) {
          syncNetworkDiscoveryPoll()
          if (
            typeof patch.networkDiscovery.enabled === 'boolean' &&
            patch.networkDiscovery.enabled !== prev.networkDiscovery.enabled
          ) {
            if (patch.networkDiscovery.enabled) {
              void get().startNetworkDiscovery()
            } else {
              stopNetworkDiscoveryUi()
              void call(api.network.cancelDiscovery()).catch(() => {})
            }
          } else if (
            typeof patch.networkDiscovery.showLocalComputer === 'boolean' &&
            patch.networkDiscovery.showLocalComputer !== prev.networkDiscovery.showLocalComputer &&
            get().settings.networkDiscovery.enabled !== false
          ) {
            void get().startNetworkDiscovery()
          }
        }
        if (patch.slideshowFeaturesEnabled === false) {
          get().resetSlideshowForGateOff()
        }
        if (patch.scripts && patch.scripts.enabled === false) {
          const d = get().dialog
          if (
            d &&
            (d.kind === 'script-manager' ||
              d.kind === 'script-run' ||
              d.kind === 'script-generate')
          ) {
            set({ dialog: null, dialogStack: [] })
          }
        }
        if (patch.mediaMetadata && typeof patch.mediaMetadata.enabled === 'boolean') {
          const folder = get().listing.path
          if (patch.mediaMetadata.enabled && folder) void refreshMediaLibraryFolder(folder)
          else {
            set({ mediaLibrary: emptyMediaLibrary() })
            resortCurrentListing()
          }
        } else if (
          patch.foldersFirst !== undefined ||
          patch.folderViews !== undefined ||
          (patch.mediaMetadata && typeof patch.mediaMetadata.mixFilesAndFolders === 'boolean')
        ) {
          resortCurrentListing()
        }
        if (patch.slideshowFeaturesEnabled === true) {
          hydrateSlideshowCacheFromSettings(
            get as unknown as Parameters<typeof hydrateSlideshowCacheFromSettings>[0],
            set as unknown as Parameters<typeof hydrateSlideshowCacheFromSettings>[1]
          )
          // Migrate legacy path-only installs when settings map is still empty.
          if (
            (settings.slideshow.categorizerMap?.length ?? 0) === 0 &&
            settings.slideshow.categorizerMapPath
          ) {
            void loadCategorizerMapFromPath(
              get as unknown as Parameters<typeof loadCategorizerMapFromPath>[0],
              set as unknown as Parameters<typeof loadCategorizerMapFromPath>[1],
              settings.slideshow.categorizerMapPath
            ).catch(() => {})
          }
        }
      } catch (e) {
        set({ settings: prev })
        if (patch.networkDiscovery) {
          syncNetworkDiscoveryPoll()
        }
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

    async pinQuickAccess(path, groupId) {
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
      const list = materializeQuickAccessList(
        s.settings.quickAccess,
        s.settings.quickAccessPins,
        s.settings.quickAccessHiddenDefaults
      )
      const token = tokenForPath(path, s.knownFolders)
      if (tokenExistsInQuickAccess(list, token)) {
        get().notify('Already in Quick access')
        return
      }
      let next: QuickAccessItem[]
      if (groupId) {
        let found = false
        next = list.map((item) => {
          if (!isQuickAccessGroup(item) || item.id !== groupId) return item
          found = true
          return { ...item, items: [...item.items, token] }
        })
        if (!found) next = [...list, token]
      } else {
        next = [...list, token]
      }
      await get().applySettingsPatch({
        quickAccess: next,
        quickAccessPins: [],
        quickAccessHiddenDefaults: []
      })
      const label = s.knownFolders.find((k) => samePath(k.path, path))?.label ?? basename(path)
      get().notify(`Pinned to Quick access: ${label}`)
    },

    async unpinQuickAccess(path) {
      const s = get()
      const entries = s.quickAccessEntries()
      const entry = entries.find((e) => samePath(e.path, path))
      if (!entry) return
      const list = materializeQuickAccessList(
        s.settings.quickAccess,
        s.settings.quickAccessPins,
        s.settings.quickAccessHiddenDefaults
      )
      await get().applySettingsPatch({
        quickAccess: removeQuickAccessToken(list, entry.token),
        quickAccessPins: [],
        quickAccessHiddenDefaults: []
      })
      get().notify(`Removed from Quick access: ${entry.label}`)
    },

    async reorderQuickAccess(fromIndex, toIndex) {
      const s = get()
      const list = materializeQuickAccessList(
        s.settings.quickAccess,
        s.settings.quickAccessPins,
        s.settings.quickAccessHiddenDefaults
      )
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= list.length ||
        toIndex >= list.length ||
        fromIndex === toIndex
      ) {
        return
      }
      const next = [...list]
      const [moved] = next.splice(fromIndex, 1)
      if (!moved) return
      next.splice(toIndex, 0, moved)
      await get().applySettingsPatch({
        quickAccess: next,
        quickAccessPins: [],
        quickAccessHiddenDefaults: []
      })
    },

    async createQuickAccessGroup(name) {
      const trimmed = name.trim().slice(0, 80)
      if (!trimmed) return
      const s = get()
      const list = materializeQuickAccessList(
        s.settings.quickAccess,
        s.settings.quickAccessPins,
        s.settings.quickAccessHiddenDefaults
      )
      const id = `qag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      await get().applySettingsPatch({
        quickAccess: [...list, { kind: 'group', id, name: trimmed, collapsed: false, items: [] }],
        quickAccessPins: [],
        quickAccessHiddenDefaults: []
      })
    },

    async renameQuickAccessGroup(id, name) {
      const trimmed = name.trim().slice(0, 80)
      if (!trimmed) return
      const s = get()
      const list = materializeQuickAccessList(
        s.settings.quickAccess,
        s.settings.quickAccessPins,
        s.settings.quickAccessHiddenDefaults
      )
      await get().applySettingsPatch({
        quickAccess: list.map((item) =>
          isQuickAccessGroup(item) && item.id === id ? { ...item, name: trimmed } : item
        ),
        quickAccessPins: [],
        quickAccessHiddenDefaults: []
      })
    },

    async deleteQuickAccessGroup(id) {
      const s = get()
      const list = materializeQuickAccessList(
        s.settings.quickAccess,
        s.settings.quickAccessPins,
        s.settings.quickAccessHiddenDefaults
      )
      const group = list.find((item) => isQuickAccessGroup(item) && item.id === id)
      if (!group || !isQuickAccessGroup(group)) return
      const next = list.flatMap((item) =>
        isQuickAccessGroup(item) && item.id === id ? group.items : [item]
      )
      await get().applySettingsPatch({
        quickAccess: next,
        quickAccessPins: [],
        quickAccessHiddenDefaults: []
      })
    },

    async setQuickAccessGroupColor(id, color) {
      const s = get()
      const list = materializeQuickAccessList(
        s.settings.quickAccess,
        s.settings.quickAccessPins,
        s.settings.quickAccessHiddenDefaults
      )
      await get().applySettingsPatch({
        quickAccess: list.map((item) =>
          isQuickAccessGroup(item) && item.id === id
            ? { ...item, color: color || undefined }
            : item
        ),
        quickAccessPins: [],
        quickAccessHiddenDefaults: []
      })
    },

    async setQuickAccessGroupCollapsed(id, collapsed) {
      const s = get()
      const list = materializeQuickAccessList(
        s.settings.quickAccess,
        s.settings.quickAccessPins,
        s.settings.quickAccessHiddenDefaults
      )
      await get().applySettingsPatch({
        quickAccess: list.map((item) =>
          isQuickAccessGroup(item) && item.id === id ? { ...item, collapsed } : item
        ),
        quickAccessPins: [],
        quickAccessHiddenDefaults: []
      })
    },

    async moveQuickAccessPinToGroup(token, groupId) {
      const s = get()
      const list = removeQuickAccessToken(
        materializeQuickAccessList(
          s.settings.quickAccess,
          s.settings.quickAccessPins,
          s.settings.quickAccessHiddenDefaults
        ),
        token
      )
      let next: QuickAccessItem[]
      if (!groupId) {
        next = [...list, token]
      } else {
        let found = false
        next = list.map((item) => {
          if (!isQuickAccessGroup(item) || item.id !== groupId) return item
          found = true
          return { ...item, items: [...item.items, token] }
        })
        if (!found) next = [...list, token]
      }
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

    async refreshScriptLibrary() {
      try {
        const res = await call(api.script.list())
        set({ scriptLibrary: res.scripts })
      } catch {
        /* runner optional until IPC is up */
      }
    },

    async exportSettingsFile() {
      try {
        const res = await call(api.settings.exportFile())
        if (!res.saved) return
        get().notify(res.path ? `Settings exported to ${res.path}` : 'Settings exported')
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async importSettingsFile() {
      const ok = window.confirm(
        'Replace all settings with the imported file?\n\n' +
          'Theme, named layouts, folder views, slideshow, context menu, network discovery, remembered Network hosts, remote repository connections (passwords are not included — re-enter them), and other preferences will be overwritten.\n\n' +
          'The main window position/size is not changed. Open tabs stay as they are (use a named layout to restore a workspace).'
      )
      if (!ok) return
      try {
        const prevHw = get().settings.disableHardwareAcceleration
        const res = await call(api.settings.importFile())
        if (!res.imported || !res.settings) return
        set({ settings: res.settings })
        syncNetworkDiscoveryPoll()
        // Rediscover when enabled so imported networkDiscovery prefs apply.
        if (res.settings.networkDiscovery.enabled !== false) {
          void get().startNetworkDiscovery()
        } else {
          stopNetworkDiscoveryUi()
          void call(api.network.cancelDiscovery()).catch(() => {})
        }
        if (res.settings.slideshowFeaturesEnabled) {
          hydrateSlideshowCacheFromSettings(
            get as unknown as Parameters<typeof hydrateSlideshowCacheFromSettings>[0],
            set as unknown as Parameters<typeof hydrateSlideshowCacheFromSettings>[1]
          )
        } else {
          get().resetSlideshowForGateOff()
        }
        const hostNote =
          typeof res.networkHostCount === 'number'
            ? ` · ${res.networkHostCount} network host${res.networkHostCount === 1 ? '' : 's'}`
            : ''
        const remoteNote =
          typeof res.remoteConnectionCount === 'number'
            ? ` · ${res.remoteConnectionCount} remote connection${res.remoteConnectionCount === 1 ? '' : 's'}`
            : ''
        const scriptNote =
          typeof res.scriptCount === 'number'
            ? ` · ${res.scriptCount} script${res.scriptCount === 1 ? '' : 's'}`
            : ''
        get().notify(`Settings imported${hostNote}${remoteNote}${scriptNote}`)
        void get().refreshScriptLibrary()
        if (res.settings.disableHardwareAcceleration !== prevHw) {
          get().notify('Hardware acceleration change applies after restart')
        }
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

    async mediaMetadataExtractPlex(paths) {
      await runMediaMetadataOp(
        'Extracting media metadata…',
        paths,
        (kindHints, _pickHints, nameHints, retryPaths) =>
          call(
            api.mediaMetadata.extractPlex({
              paths: retryPaths ?? paths,
              kindHints,
              nameHints
            })
          )
      )
    },

    async mediaMetadataDownload(paths) {
      await runMediaMetadataOp(
        'Downloading media metadata…',
        paths,
        (kindHints, pickHints, nameHints, retryPaths) =>
          call(
            api.mediaMetadata.download({
              paths: retryPaths ?? paths,
              kindHints,
              pickHints,
              nameHints
            })
          )
      )
    },

    async mediaMetadataRefresh(paths) {
      await runMediaMetadataOp(
        'Refreshing media metadata…',
        paths,
        (kindHints, pickHints, nameHints, retryPaths) =>
          call(
            api.mediaMetadata.refresh({
              paths: retryPaths ?? paths,
              kindHints,
              pickHints,
              nameHints
            })
          )
      )
    },

    async mediaMetadataClear(paths) {
      await runMediaMetadataOp('Clearing media metadata…', paths, () =>
        call(api.mediaMetadata.clear({ paths }))
      )
    },

    async mediaMetadataConsolidateSubtitles(paths) {
      if (!get().settings.mediaMetadata.enabled) return
      const ok = await get().askConfirm({
        title: 'Consolidate subtitles?',
        message:
          'Copy the first English subtitle (.srt preferred) next to each video, then send Subs / Subtitles folders to the Recycle Bin.',
        confirmLabel: 'Consolidate',
        danger: true
      })
      if (!ok) return
      try {
        const res = await withBusyFeedback(
          'media-metadata',
          'Consolidating subtitles…',
          undefined,
          () => call(api.mediaMetadata.consolidateSubtitles({ paths }))
        )
        const folder = get().listing.path
        if (folder) void get().refresh()
        const failN = res.failed.length
        if (res.copied === 0 && res.recycled === 0 && failN === 0) {
          get().notify('No Subs folders with English subtitles found')
        } else if (failN > 0) {
          get().notify(
            `Copied ${res.copied} · ${failN} failed${res.failed[0] ? ` (${res.failed[0].message})` : ''}`,
            true
          )
        } else {
          get().notify(
            res.copied === 1
              ? `Copied 1 subtitle${res.recycled ? ' · Subs sent to Recycle Bin' : ''}`
              : `Copied ${res.copied} subtitles${res.recycled ? ` · ${res.recycled} Subs folder${res.recycled === 1 ? '' : 's'} sent to Recycle Bin` : ''}`
          )
        }
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async mediaMetadataSetWatched(paths, watched) {
      if (!get().settings.mediaMetadata.enabled) return
      try {
        const res = await call(api.mediaMetadata.setWatched({ paths, watched }))
        const folder = get().listing.path
        get().invalidateContentThumbs([...res.updated, ...paths, ...(folder ? [folder] : [])])
        if (folder) void refreshMediaLibraryFolder(folder)
        get().notify(watched ? 'Marked as watched' : 'Marked as unwatched')
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    setMediaLibraryWatchedFilter(value) {
      set((s) => ({ mediaLibrary: { ...s.mediaLibrary, watchedFilter: value } }))
      viewOrderCache = null
    },

    setMediaLibraryGenreFilter(genre) {
      set((s) => ({ mediaLibrary: { ...s.mediaLibrary, genreFilter: genre } }))
      viewOrderCache = null
    },

    async calculateFolderStatistics(folderPath, opts) {
      try {
        const res = await call(
          api.fs.calculateFolderStatistics({
            path: folderPath,
            ...(opts?.skipTagged ? { skipTagged: true } : {}),
            ...(opts?.skipOnError ? { skipOnError: true } : {})
          })
        )
        get().bumpColumnMeta(res.path)
        if (opts?.skipOnError) {
          try {
            const settings = await call(api.settings.get())
            set({ settings })
          } catch {
            /* keep the in-memory skip list from Skip all */
          }
        }
        const skipped =
          res.foldersSkipped != null && res.foldersSkipped > 0
            ? ` · ${res.foldersSkipped.toLocaleString()} skipped`
            : ''
        get().notify(
          `Statistics saved — ${res.foldersTagged.toLocaleString()} folders tagged${skipped} · ${res.fileTotCount.toLocaleString()} files · ${res.folderTotCount.toLocaleString()} folders · ${formatBytes(res.totalSize)}`
        )
      } catch (e) {
        reportOperationError('Calculate Statistics failed', e, {
          retryFolderStats: { path: folderPath }
        })
      }
    },

    setSearchQuery(q) {
      const tab = get().activeTab()
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
      const trimmed = q.trim()
      if (!trimmed) {
        updateTab(tab.id, { search: { ...tab.search, query: q } })
        if (get().activeTab().search.active) get().clearSearch()
        return
      }

      const walkQuery = tab.search.walkQuery.trim()
      const narrowing =
        (tab.search.running || tab.search.walkItems.length > 0) &&
        isSearchNarrowing(walkQuery || tab.search.query, trimmed)

      if (narrowing) {
        const source = tab.search.walkItems.length > 0 ? tab.search.walkItems : tab.search.results
        updateTab(tab.id, {
          search: {
            ...tab.search,
            query: q,
            results: narrowSearchItems(source, walkQuery || tab.search.query, trimmed)
          }
        })
        // Still walking the broader query — keep it; just show the subset.
        if (tab.search.partial && !tab.search.running && source.length > 0) {
          const next = narrowSearchItems(source, walkQuery || tab.search.query, trimmed)
          if (next.length === 0) {
            searchDebounceTimer = setTimeout(() => {
              searchDebounceTimer = null
              void get().runSearch()
            }, SEARCH_DEBOUNCE_MS)
          }
        }
        return
      }

      updateTab(tab.id, { search: { ...tab.search, query: q } })
      if (isIncompleteSearchQuery(trimmed)) return

      searchDebounceTimer = setTimeout(() => {
        searchDebounceTimer = null
        void get().runSearch()
      }, SEARCH_DEBOUNCE_MS)
    },

    setSearchIndexedOnly(v) {
      const tab = get().activeTab()
      updateTab(tab.id, { search: { ...tab.search, indexedOnly: v } })
      void get().applySettingsPatch({ searchIndexedOnly: v })
      if (tab.search.active && tab.search.query.trim()) {
        void get().runSearch()
      }
    },

    async runSearch(tabId) {
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer)
        searchDebounceTimer = null
      }
      const id = tabId ?? get().activeTabId
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab) return
      const query = tab.search.query.trim()
      if (!query || isIncompleteSearchQuery(query)) return
      const walkQ = tab.search.walkQuery.trim()
      if (
        walkQ &&
        isSearchNarrowing(walkQ, query) &&
        (tab.search.running || (!tab.search.partial && tab.search.walkItems.length > 0))
      ) {
        updateTab(id, {
          search: {
            ...tab.search,
            query,
            results: narrowSearchItems(tab.search.walkItems, walkQ, query)
          }
        })
        return
      }
      if (id === get().activeTabId && get().recycleBin.active) get().closeRecycleBinView()
      void api.search.cancel()
      const seq = ++searchSeq
      const indexedOnly = tab.search.indexedOnly
      const settings = get().settings
      get().setViewMode('details', id)
      const entering = !tab.search.active
      const last = tab.back[tab.back.length - 1]
      const folderHere = folderHistory(tab.path, liveFileViewScroll(tab.id) ?? tab.scrollOffset)
      const back =
        entering && !(last && sameHistoryEntry(last, folderHere))
          ? [...tab.back, folderHere]
          : tab.back
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id === tab.id) {
            return {
              ...t,
              back: entering ? back : t.back,
              forward: entering ? [] : t.forward,
              selected: [],
              search: {
                ...t.search,
                query,
                indexedOnly,
                active: true,
                running: true,
                results: [],
                partial: false,
                source: null,
                contentSlow: false,
                progress: 'Starting search…',
                gen: seq,
                message: null,
                dismissed: [],
                walkQuery: query,
                walkItems: []
              }
            }
          }
          if (t.search.running) {
            return { ...t, search: { ...t.search, running: false, progress: null } }
          }
          return t
        })
      }))
      updateTab(tab.id, {})
      if (id === get().activeTabId) {
        set({ selectionAnchor: null, focusedPath: null })
      }
      try {
        const res = await call(
          api.search.query({
            query,
            scope: indexedOnly
              ? { type: 'indexed' }
              : {
                  type: 'folder',
                  path: get().tabs.find((t) => t.id === tab.id)?.path ?? tab.path,
                  recursive: true,
                  useIndexIfCovered: true
                },
            limit: 2000,
            offset: 0,
            matchPath: settings.searchMatchPath,
            matchCase: settings.searchMatchCase,
            wholeWord: settings.searchWholeWord,
            regex: settings.searchRegex,
            gen: seq
          })
        )
        const owner = get().tabs.find((t) => t.id === tab.id)
        if (!owner || owner.search.gen !== seq) return
        const walkItems = pruneSearchResultItems(res.items, owner.search.dismissed ?? [])
        updateTab(tab.id, {
          search: {
            ...owner.search,
            running: false,
            walkItems,
            results: narrowSearchItems(walkItems, owner.search.walkQuery, owner.search.query),
            partial: res.partial,
            source: res.source,
            contentSlow: Boolean(res.contentSlow),
            progress: null,
            message: res.message ?? null
          }
        })
        if (res.message) get().notify(res.message, true)
      } catch (e) {
        const owner = get().tabs.find((t) => t.id === tab.id)
        if (!owner || owner.search.gen !== seq) return
        updateTab(tab.id, { search: { ...owner.search, running: false, progress: null } })
        if (!(e instanceof IpcError && e.code === 'cancelled')) {
          get().notify(e instanceof IpcError ? e.message : String(e), true)
        }
      }
    },

    clearSearch(tabId) {
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer)
        searchDebounceTimer = null
      }
      const id = tabId ?? get().activeTabId
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab) return
      if (tab.search.running) {
        searchSeq++
        void api.search.cancel()
      }
      const last = tab.back[tab.back.length - 1]
      const back =
        last?.kind === 'folder' && samePath(last.path, tab.path) ? tab.back.slice(0, -1) : tab.back
      updateTab(id, {
        back,
        search: { ...emptyTabSearch(tab.search.indexedOnly), query: '' }
      })
      if (id === get().activeTabId) {
        const sort = get().activeTab().sort
        if (sort.key === 'folder') get().setSort({ key: 'name', dir: sort.dir })
      }
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
      // Bin selection uses recyclePath — clear so the folder view isn't left
      // with a $Recycle.Bin path that isn't in the current listing.
      updateActiveTab({ selected: [] })
      set({ selectionAnchor: null, focusedPath: null })
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
          target.length === 1
            ? (s.recycleBin.items.find(
                (i) => samePath(i.recyclePath, target[0]!) || samePath(i.originalPath, target[0]!)
              )?.name ?? basename(target[0]!))
            : `${target.length} items`,
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
        if (get().recycleBin.active) {
          await get().refreshRecycleBinView()
          updateActiveTab({ selected: [] })
          set({ selectionAnchor: null, focusedPath: null })
        }
      } catch (e) {
        reportOperationError('Empty Recycle Bin failed', e)
      }
    },

    deleteFromRecycleBinView(paths) {
      const s = get()
      const target = paths ?? s.activeTab().selected
      if (target.length === 0) return
      const anyDir = target.some((p) => {
        const it = s.recycleBin.items.find(
          (i) => samePath(i.recyclePath, p) || samePath(i.originalPath, p)
        )
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
          paths.length === 1
            ? (get().recycleBin.items.find(
                (i) => samePath(i.recyclePath, paths[0]!) || samePath(i.originalPath, paths[0]!)
              )?.name ?? basename(paths[0]!))
            : `${paths.length} items`,
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
async function resolveClipboard(get: () => { clipboard: ClipboardState }): Promise<ClipboardState> {
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
