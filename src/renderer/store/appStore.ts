import { create } from 'zustand'
import type {
  DirEntry,
  ConflictPolicy,
  ConflictDecision,
  ConflictItem,
  DriveInfo
} from '@shared/schemas/fs'
import type { SessionState, SortSpec, TabState, ViewMode, Splitters } from '@shared/schemas/session'
import { MAX_TREE_EXPANDED } from '@shared/schemas/session'
import type { Settings, SettingsPatch } from '@shared/schemas/settings'
import type { IndexRootInfo, SearchResultItem } from '@shared/schemas/search'
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
import {
  buildQuickAccess,
  materializeQuickAccessTokens,
  tokenForPath,
  type KnownFolder,
  type KnownFolderId,
  type QuickAccessEntry
} from '../lib/quickAccess'
import { isExcludedByViewFilter } from '../lib/viewFilter'
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
  | { kind: 'alert'; title: string; message: string; detail?: string }
  | null

export type ContextMenuState = {
  x: number
  y: number
  /** paths the menu applies to; empty = folder background */
  paths: string[]
  inTree?: boolean
} | null

export type SearchState = {
  active: boolean
  query: string
  running: boolean
  indexedOnly: boolean
  results: SearchResultItem[]
  partial: boolean
  source: 'index' | 'walk' | null
  progress: string | null
}

export type Notice = { text: string; isError: boolean } | null

/** Live progress for copy / move / trash / permanent delete (main → op-progress). */
export type FileOpProgress = {
  opId: string
  kind: 'copy' | 'move' | 'trash' | 'delete' | 'relocate' | 'vid-thumbs'
  done: number
  total: number
  current?: string
  label?: string
}

let tabCounter = 0
function newTabId(): string {
  return `tab_${Date.now().toString(36)}_${(tabCounter++).toString(36)}`
}

let listRequestSeq = 0
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
  dialog: DialogState
  /** In-app full-size image viewer (double-click / Enter on images). */
  imageViewer: { path: string; siblings: string[] } | null
  /** In-app Filerobot image editor (preview Edit button / context menu). */
  imageEditor: { path: string; mediaUrl: string } | null
  /**
   * When true, preview/viewer detach media elements so Windows can delete/rename
   * files that Chromium had open via mfe-media.
   */
  mediaHold: boolean
  contextMenu: ContextMenuState
  search: SearchState
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
  navigate(path: string, opts?: { push?: boolean }): Promise<void>
  goBack(): Promise<void>
  goForward(): Promise<void>
  goUp(): Promise<void>
  refresh(): Promise<void>
  setAddressEditing(v: boolean): void

  // tabs
  newTab(path?: string, rootPath?: string): Promise<void>
  /** Open/reveal a path from CLI or another app (new or existing tab). */
  openExternalTarget(path: string, reveal: boolean): Promise<void>
  closeTab(id: string): Promise<void>
  activateTab(id: string): Promise<void>
  nextTab(): Promise<void>
  renameTab(id: string, title: string | null): void
  reorderTab(fromIndex: number, toIndex: number): void

  // view state
  setViewMode(mode: ViewMode): void
  setSort(sort: SortSpec): void
  setScrollOffset(offset: number): void
  /** Persist folder-tree expansion for the active tab (session). */
  setTreeExpanded(paths: string[]): void
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
  setSelection(paths: string[], anchor?: string | null, focused?: string | null): void
  selectAll(): void

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
   * `missing` skips complete strips; `all` regenerates.
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
  removeIndexRootAction(path: string): Promise<void>
  reindexAction(path?: string): Promise<void>
  refreshIndexRoots(): Promise<void>
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
        splitters: s.splitters
      }
      void api.session.set(session)
    }, 500)
  }

  const OFFLINE_POLL_MS = 8_000
  let offlinePollTimer: ReturnType<typeof setInterval> | null = null
  let offlinePollPath: string | null = null

  function stopOfflinePoll(): void {
    if (offlinePollTimer) {
      clearInterval(offlinePollTimer)
      offlinePollTimer = null
    }
    offlinePollPath = null
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

  function startOfflinePoll(path: string): void {
    if (offlinePollTimer && offlinePollPath && samePath(offlinePollPath, path)) return
    stopOfflinePoll()
    offlinePollPath = path
    offlinePollTimer = setInterval(() => {
      const s = get()
      if (!s.booted || !s.listing.offline || !samePath(s.activeTab().path, path)) {
        stopOfflinePoll()
        return
      }
      void (async () => {
        try {
          const d = await call(api.fs.listDrives())
          set({ drives: d.drives })
        } catch {
          // ignore drive-list failures during poll
        }
        await loadListing(path, { preserveSelection: true, soft: true })
      })()
    }, OFFLINE_POLL_MS)
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
      const r = await runTransfer(op2, src, dest, policy)
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
    opts?: { preserveSelection?: boolean; soft?: boolean }
  ): Promise<void> {
    const seq = ++listRequestSeq
    if (!opts?.soft) {
      set((s) => ({
        listing: { ...s.listing, path, loading: true, error: null, offline: false }
      }))
    }
    try {
      const res = await call(api.fs.list({ path, includeHidden: true }))
      if (seq !== listRequestSeq) return // superseded
      stopOfflinePoll()
      set((s) => {
        const valid = new Set(res.entries.map((e) => e.path.toLowerCase()))
        const tabs = s.tabs.map((t) =>
          t.id === s.activeTabId
            ? {
                ...t,
                selected: opts?.preserveSelection
                  ? t.selected.filter((p) => valid.has(p.toLowerCase()))
                  : t.selected
              }
            : t
        )
        return {
          listing: {
            path: res.path,
            entries: res.entries,
            loading: false,
            error: null,
            offline: false
          },
          tabs
        }
      })
      void api.fs.watch({ path })
    } catch (e) {
      if (seq !== listRequestSeq) return
      const offline = isOfflineFailure(e)
      const message = e instanceof IpcError ? e.message : String(e)
      set({
        listing: {
          path,
          entries: [],
          loading: false,
          error: offline ? null : message,
          offline
        }
      })
      if (offline) startOfflinePoll(path)
      else stopOfflinePoll()
    }
  }

  function updateActiveTab(patch: Partial<Tab>): void {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, ...patch } : t))
    }))
    scheduleSessionSave()
  }

  /** Always surface FS failures in a modal — never status-bar-only. */
  function reportOperationError(title: string, e: unknown): void {
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

  /** Drop preview/viewer media briefly so OS file locks are released. */
  async function releaseMediaLocks(): Promise<void> {
    set({ mediaHold: true })
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 60)
    })
  }

  async function afterPathsRemoved(removed: string[]): Promise<void> {
    if (get().mediaHold) set({ mediaHold: false })
    syncImageViewerAfterDelete(removed)
    notifyTreeRemoved(removed)
    const tab = get().activeTab()
    const current = tab.path
    const primary =
      removed.find((p) => samePath(p, current) || isUnderPath(current, p)) ?? null

    if (!primary) {
      // Stay in the folder: pick the next visible item (Explorer-style), else previous.
      const s = get()
      const owning = resolveFolderView(tab.path, s.settings.folderViews)
      const sort = owning?.sort ?? tab.sort
      const before = sortEntries(
        s.listing.entries.filter(
          (e) => !isExcludedByViewFilter(e, s.settings.viewFilterPatterns, s.settings.viewFilterEnabled)
        ),
        sort,
        s.settings.foldersFirst
      )
      const nextPath = nextSelectionAfterDelete(before.map((e) => e.path), removed)
      await get().refresh()
      if (nextPath) {
        const stillThere = get().listing.entries.some((e) => samePath(e.path, nextPath))
        if (stillThere) {
          updateActiveTab({ selected: [nextPath] })
          set({ selectionAnchor: nextPath, focusedPath: nextPath })
          return
        }
      }
      updateActiveTab({ selected: [] })
      set({ selectionAnchor: null, focusedPath: null })
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
        const res = await call(api.fs.restoreFromTrash({ paths: entry.paths }))
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
      await call(api.fs.trash({ paths: entry.paths }))
      await afterPathsRemoved(entry.paths)
      return
    }

    if (entry.kind === 'create' || entry.kind === 'copy') {
      if (direction === 'undo') {
        await call(api.fs.trash({ paths: entry.paths }))
        await afterPathsRemoved(entry.paths)
        return
      }
      const res = await call(api.fs.restoreFromTrash({ paths: entry.paths }))
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
      await call(api.fs.relocate({ pairs }))
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
    await call(api.fs.relocate({ pairs }))
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
    listing: { path: '', entries: [], loading: false, error: null, offline: false },
    selectionAnchor: null,
    focusedPath: null,
    renamingPath: null,
    renameSource: null,
    treeFocusPath: null,
    clipboard: null,
    dragPaths: [],
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
      progress: null
    },
    indexRoots: [],
    indexProgress: {},
    fileOp: null,
    videoThumbRev: 0,
    notice: null,
    addressEditing: false,
    treeMutation: { rev: 0, removed: [], reloadParents: [] },
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

      set({
        booted: true,
        settings,
        homePath: home.path,
        knownFolders,
        drives: drivesRes.drives,
        tabs,
        activeTabId,
        splitters,
        selectionAnchor: focus.selectionAnchor,
        focusedPath: focus.focusedPath
      })

      api.onEvent((event: MfeEvent) => {
        const s = get()
        if (event.type === 'fs-changed') {
          if (samePath(event.payload.path, s.activeTab().path)) {
            void loadListing(s.activeTab().path, { preserveSelection: true })
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
                label: p.label
              }
            })
          }
        } else if (event.type === 'external-open') {
          void get().openExternalTarget(event.payload.path, event.payload.reveal)
        }
      })

      void get().refreshIndexRoots()
      await loadListing(get().activeTab().path)
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
      const tab = s.activeTab()
      const old = tab.path
      if (tab.rootPath && !isUnderPath(path, tab.rootPath)) {
        get().notify(`This tab is limited to ${basename(tab.rootPath)} — open a new tab to leave`)
        return
      }
      if (get().search.active) get().clearSearch()
      flushPendingRename()
      if (push && !samePath(old, path)) {
        updateActiveTab({
          path,
          back: [...tab.back, old],
          forward: [],
          selected: [],
          scrollOffset: 0
        })
      } else {
        updateActiveTab({ path, selected: [] })
      }
      set({ selectionAnchor: null, focusedPath: null, renamingPath: null, renameSource: null, addressEditing: false })
      if (!samePath(old, path)) void api.fs.unwatch({ path: old })
      await loadListing(path)
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
      await loadListing(prev)
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
      await loadListing(next)
    },

    async goUp() {
      const tab = get().activeTab()
      const parent = parentOf(tab.path)
      if (!parent) return
      if (tab.rootPath && !isUnderPath(parent, tab.rootPath)) return
      await get().navigate(parent)
    },

    async refresh() {
      await loadListing(get().activeTab().path, { preserveSelection: true })
    },

    setAddressEditing(v) {
      set({ addressEditing: v })
    },

    async newTab(path, rootPath) {
      const s = get()
      const target = path ?? s.activeTab().path ?? s.settings.defaultNewTabPath ?? s.homePath
      const tab: Tab = {
        id: newTabId(),
        path: target,
        title: null,
        viewMode: s.activeTab().viewMode,
        sort: { key: 'name', dir: 'asc' },
        back: [],
        forward: [],
        selected: [],
        scrollOffset: 0,
        rootPath: rootPath ?? null,
        treeExpanded: []
      }
      set({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        selectionAnchor: null,
        focusedPath: null
      })
      scheduleSessionSave()
      await loadListing(target)
    },

    async closeTab(id) {
      const s = get()
      if (s.tabs.length <= 1) return
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      let activeTabId = s.activeTabId
      if (id === s.activeTabId) {
        const nextIdx = Math.min(idx, tabs.length - 1)
        activeTabId = tabs[nextIdx]!.id
      }
      const focus = focusFromSelection(tabs.find((t) => t.id === activeTabId)?.selected ?? [])
      set({
        tabs,
        activeTabId,
        selectionAnchor: focus.selectionAnchor,
        focusedPath: focus.focusedPath
      })
      scheduleSessionSave()
      if (id === s.activeTabId) await loadListing(get().activeTab().path)
    },

    async activateTab(id) {
      if (get().activeTabId === id) return
      if (get().search.active) get().clearSearch()
      flushPendingRename()
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab) return
      const focus = focusFromSelection(tab.selected)
      set({
        activeTabId: id,
        selectionAnchor: focus.selectionAnchor,
        focusedPath: focus.focusedPath,
        renamingPath: null,
        renameSource: null
      })
      scheduleSessionSave()
      await loadListing(tab.path)
    },

    setTreeExpanded(paths) {
      const capped =
        paths.length > MAX_TREE_EXPANDED ? paths.slice(paths.length - MAX_TREE_EXPANDED) : paths
      const cur = get().activeTab().treeExpanded
      if (sameExpandedSet(cur, capped)) return
      updateActiveTab({ treeExpanded: capped })
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

    setViewMode(mode) {
      const s = get()
      const owning = resolveFolderView(s.activeTab().path, s.settings.folderViews)
      if (owning) {
        void get().applySettingsPatch({
          folderViews: patchFolderView(s.settings.folderViews, owning.path, { viewMode: mode })
        })
        return
      }
      updateActiveTab({ viewMode: mode })
    },

    setSort(sort) {
      const s = get()
      const owning = resolveFolderView(s.activeTab().path, s.settings.folderViews)
      if (owning) {
        void get().applySettingsPatch({
          folderViews: patchFolderView(s.settings.folderViews, owning.path, { sort })
        })
        return
      }
      updateActiveTab({ sort })
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
      const owning = resolveFolderView(s.activeTab().path, s.settings.folderViews)
      if (owning) {
        await get().applySettingsPatch({
          folderViews: patchFolderView(s.settings.folderViews, owning.path, patch)
        })
        return
      }
      await get().applySettingsPatch(patch)
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
          splitters: s.splitters
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
            splitters: s.splitters
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
      get().clearSearch()
      flushPendingRename()
      set({
        tabs,
        activeTabId: active.id,
        splitters: { ...layout.splitters },
        selectionAnchor: null,
        focusedPath: null,
        renamingPath: null,
        renameSource: null,
        treeFocusPath: null,
        dialog: null,
        contextMenu: null
      })
      scheduleSessionSave()
      await loadListing(active.path)
      get().notify(`Applied layout “${layout.name}”`)
    },

    setScrollOffset(offset) {
      // no session save churn for every scroll — update silently, save on other triggers
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, scrollOffset: offset } : t))
      }))
    },

    setSplitters(patch) {
      set((s) => ({ splitters: { ...s.splitters, ...patch } }))
      scheduleSessionSave()
    },

    setSelection(paths, anchor, focused) {
      updateActiveTab({ selected: paths })
      set({
        selectionAnchor: anchor === undefined ? get().selectionAnchor : anchor,
        focusedPath: focused === undefined ? get().focusedPath : focused
      })
    },

    selectAll() {
      const s = get()
      updateActiveTab({
        selected: s.listing.entries
          .filter(
            (e) =>
              !isExcludedByViewFilter(e, s.settings.viewFilterPatterns, s.settings.viewFilterEnabled)
          )
          .map((e) => e.path)
      })
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
      if (!newName.trim()) return
      const oldName = basename(path)
      if (newName === oldName) return
      try {
        await releaseMediaLocks()
        const res = await call(api.fs.rename({ path, newName: newName.trim() }))
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
      const target = paths ?? s.activeTab().selected
      if (target.length === 0) return
      if (!permanent) {
        try {
          await releaseMediaLocks()
          await call(api.fs.trash({ paths: target }))
          recordUndo({
            kind: 'trash',
            paths: [...target],
            label: basename(target[0]!)
          })
          get().notify(`Moved ${target.length} item${target.length > 1 ? 's' : ''} to Recycle Bin`)
          await afterPathsRemoved(target)
        } catch (e) {
          set({ mediaHold: false })
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
          await releaseMediaLocks()
          await call(api.fs.deletePermanent({ paths: toDelete }))
          get().notify(`Permanently deleted ${toDelete.length} item${toDelete.length > 1 ? 's' : ''}`)
          await afterPathsRemoved(toDelete)
        } catch (e) {
          set({ mediaHold: false })
          reportOperationError('Delete failed', e)
        }
      }
    },

    async confirmPermanentDelete(confirmed) {
      const dialog = get().dialog
      set({ dialog: null })
      if (!dialog || dialog.kind !== 'confirm-permanent-delete' || !confirmed) return
      try {
        await releaseMediaLocks()
        await call(api.fs.deletePermanent({ paths: dialog.paths }))
        get().notify(
          `Permanently deleted ${dialog.paths.length} item${dialog.paths.length > 1 ? 's' : ''}`
        )
        await afterPathsRemoved(dialog.paths)
      } catch (e) {
        set({ mediaHold: false })
        reportOperationError('Delete failed', e)
      }
    },

    async openEntry(entry) {
      if (entry.kind === 'dir') {
        await get().navigate(entry.path)
        return
      }
      if (isImageExt(entry.ext)) {
        get().openImageViewer(entry.path)
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
      set({ dragPaths: paths })
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
      try {
        const settings = await call(api.settings.set(patch))
        set({ settings })
      } catch (e) {
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
        const res = await call(
          api.thumbs.generateVidCache({
            paths,
            mode,
            recursive: opts?.recursive ?? false
          })
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
    },

    setSearchIndexedOnly(v) {
      set((s) => ({ search: { ...s.search, indexedOnly: v } }))
    },

    async runSearch() {
      const s = get()
      const query = s.search.query.trim()
      if (!query) return
      set({
        search: {
          ...s.search,
          active: true,
          running: true,
          results: [],
          partial: false,
          source: null,
          progress: null
        }
      })
      try {
        const res = await call(
          api.search.query({
            query,
            scope: s.search.indexedOnly
              ? { type: 'indexed' }
              : {
                  type: 'folder',
                  path: s.activeTab().path,
                  recursive: true,
                  useIndexIfCovered: true
                },
            limit: 1000,
            offset: 0
          })
        )
        set((state) => ({
          search: {
            ...state.search,
            running: false,
            results: res.items,
            partial: res.partial,
            source: res.source,
            progress: null
          }
        }))
      } catch (e) {
        set((state) => ({ search: { ...state.search, running: false, progress: null } }))
        if (!(e instanceof IpcError && e.code === 'cancelled')) {
          get().notify(e instanceof IpcError ? e.message : String(e), true)
        }
      }
    },

    clearSearch() {
      void api.search.cancel()
      set((s) => ({
        search: {
          ...s.search,
          active: false,
          running: false,
          results: [],
          partial: false,
          source: null,
          progress: null,
          query: ''
        }
      }))
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
  const sorted = [...entries].sort((a, b) => {
    if (foldersFirst) {
      const ad = a.kind === 'dir' ? 0 : 1
      const bd = b.kind === 'dir' ? 0 : 1
      if (ad !== bd) return ad - bd
    }
    let cmp = 0
    switch (sort.key) {
      case 'name':
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
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
        cmp =
          a.ext.localeCompare(b.ext) || a.name.localeCompare(b.name, undefined, { numeric: true })
        break
    }
    if (cmp === 0 && sort.key !== 'name') {
      cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
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
