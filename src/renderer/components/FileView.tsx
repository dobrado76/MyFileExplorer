import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DirEntry } from '@shared/schemas/fs'
import type { SortKey } from '@shared/schemas/session'
import type { DetailsColumnId } from '@shared/schemas/settings'
import {
  COLUMN_GROUP_LABELS,
  COLUMN_GROUP_ORDER,
  DETAILS_COLUMN_IDS,
  DETAILS_COLUMN_META,
  isAsyncColumn,
  type EntryColumnValues
} from '@shared/schemas/columns'
import { resolveFolderView } from '@shared/folderViews'
import { useAppStore, sortEntries, dropOperation } from '../store/appStore'
import { samePath, isUnderPath, parentOf, basename } from '../lib/paths'
import {
  beginRightDragGesture,
  getLiveRightDragSession,
  shouldSuppressContextMenu
} from '../lib/rightDrag'
import {
  beginLeftFileDragGesture,
  shouldSuppressClickAfterLeftDrag
} from '../lib/leftFileDrag'
import {
  cancelDoubleSingleClick,
  isNameLabelTarget,
  noteItemClick,
  tryLabelRenameClick
} from '../lib/doubleSingleClick'
import { formatBytes, formatDate, typeLabel } from '../lib/format'
import { isImageExt, isVideoExt } from '../lib/icons'
import { displayFileName } from '@shared/hideNameExtensions'
import { compileViewFilter } from '../lib/viewFilter'
import { searchResultsToEntries } from '../lib/searchEntries'
import { recycleBinItemsToEntries } from '../lib/recycleBinEntries'
import type { RecycleBinItem } from '@shared/schemas/recycle'
import { api } from '../lib/ipc'
import { ThumbImage } from './ThumbImage'
import { ShellIcon } from './ShellIcon'
import { RenameInput } from './RenameInput'

/** Details columns only while browsing the Recycle Bin (not part of folder column layout). */
type RecycleDetailsColId = 'origin' | 'dateDeleted' | 'size' | 'type'
const RECYCLE_DETAILS_COLS: {
  id: RecycleDetailsColId
  label: string
  width: number
  numeric?: boolean
}[] = [
  { id: 'origin', label: 'Original location', width: 340 },
  { id: 'dateDeleted', label: 'Date deleted', width: 150 },
  { id: 'size', label: 'Size', width: 90, numeric: true },
  { id: 'type', label: 'Type', width: 120 }
]

const GRID_SPECS = {
  // Same cell footprint as Extra large; name row omitted when a content thumb is ready.
  extraLargeIconsNoName: { cellW: 260, cellH: 300, thumb: 248 },
  extraLargeIcons: { cellW: 260, cellH: 300, thumb: 240 },
  largeIcons: { cellW: 164, cellH: 200, thumb: 144 },
  mediumIcons: { cellW: 120, cellH: 148, thumb: 96 },
  smallIcons: { cellW: 88, cellH: 108, thumb: 64 }
} as const

type GridMode = keyof typeof GRID_SPECS

const SYNC_SORT_KEYS = new Set<SortKey>([
  'name',
  'folder',
  'mtime',
  'ctime',
  'size',
  'type',
  'ext'
])

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/** Explorer-style typeahead: clear buffer after this idle gap. */
const TYPEAHEAD_MS = 750

function entryStartsWith(name: string, prefix: string): boolean {
  return name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
}

/** Next index after `from` (exclusive) matching prefix; wraps. `-1` if none. */
function findTypeaheadIndex(entries: DirEntry[], prefix: string, from: number): number {
  if (!prefix || entries.length === 0) return -1
  const start = from < 0 ? 0 : from + 1
  for (let i = 0; i < entries.length; i++) {
    const idx = (start + i) % entries.length
    if (entryStartsWith(entries[idx]!.name, prefix)) return idx
  }
  return -1
}

function recycleDetailCellValue(
  id: RecycleDetailsColId,
  e: DirEntry,
  item: RecycleBinItem | undefined
): string {
  switch (id) {
    case 'origin':
      return item?.deletedFrom || ''
    case 'dateDeleted':
      return formatDate(item?.dateDeletedMs ?? e.mtimeMs)
    case 'size':
      return e.kind === 'dir' ? '' : formatBytes(e.size)
    case 'type':
      return typeLabel(e.ext, e.kind === 'dir')
  }
}

function detailCellValue(
  id: DetailsColumnId,
  e: DirEntry,
  meta: EntryColumnValues | undefined
): string {
  switch (id) {
    case 'folder':
      return parentOf(e.path) ?? ''
    case 'mtime':
      return formatDate(e.mtimeMs)
    case 'ctime':
      return e.birthtimeMs ? formatDate(e.birthtimeMs) : ''
    case 'type':
      return typeLabel(e.ext, e.kind === 'dir')
    case 'size':
      return e.kind === 'dir' ? '' : formatBytes(e.size)
    case 'ext':
      return e.ext
    default:
      return meta?.[id] ?? ''
  }
}

function parseDurationSort(s: string): number {
  const parts = s.split(':').map((p) => Number(p))
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return NaN
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  return parts[0]! * 60 + parts[1]!
}

function compareColumnValues(id: DetailsColumnId, a: string, b: string): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  if (id === 'duration') {
    const na = parseDurationSort(a)
    const nb = parseDurationSort(b)
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  }
  if (DETAILS_COLUMN_META[id].numeric) {
    const na = parseFloat(a.replace(/[^0-9.-]+/g, ' ').trim())
    const nb = parseFloat(b.replace(/[^0-9.-]+/g, ' ').trim())
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

type FileViewProps = {
  /** When set, bound to that tab’s listing (multi-pane). Default: active tab. */
  tabId?: string
}

export function FileView({ tabId: tabIdProp }: FileViewProps = {} as FileViewProps): JSX.Element {
  const activeTabIdStore = useAppStore((s) => s.activeTabId)
  const tabId = tabIdProp ?? activeTabIdStore
  const isFocusedSurface = tabId === activeTabIdStore
  const listing = useAppStore((s) => s.listingsByTabId[tabId] ?? s.listing)
  const settings = useAppStore((s) => s.settings)
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === tabId))
  const setSelectionRaw = useAppStore((s) => s.setSelection)
  const setSelection = useCallback(
    (paths: string[], anchor?: string | null, focused?: string | null) => {
      setSelectionRaw(paths, anchor, focused, tabId)
    },
    [setSelectionRaw, tabId]
  )
  const selectionAnchor = useAppStore((s) =>
    s.activeTabId === tabId ? s.selectionAnchor : null
  )
  const focusedPath = useAppStore((s) =>
    s.activeTabId === tabId
      ? s.focusedPath
      : (s.tabs.find((t) => t.id === tabId)?.selected.slice(-1)[0] ?? null)
  )
  const fileListScrollRequest = useAppStore((s) => s.fileListScrollRequest)
  const clearFileListScrollRequest = useAppStore((s) => s.clearFileListScrollRequest)
  const openEntry = useAppStore((s) => s.openEntry)
  const startRename = useAppStore((s) => s.startRename)
  const renamingPath = useAppStore((s) => s.renamingPath)
  const renameSource = useAppStore((s) => s.renameSource)
  const submitRename = useAppStore((s) => s.submitRename)
  const cancelRename = useAppStore((s) => s.cancelRename)
  const clipboard = useAppStore((s) => s.clipboard)
  const dragPaths = useAppStore((s) => s.dragPaths)
  const setDragPaths = useAppStore((s) => s.setDragPaths)
  const dropHighlightPath = useAppStore((s) => s.dropHighlightPath)
  const setDropHighlight = useAppStore((s) => s.setDropHighlight)
  const performTransfer = useAppStore((s) => s.performTransfer)
  const openContextMenu = useAppStore((s) => s.openContextMenu)
  const setSortRaw = useAppStore((s) => s.setSort)
  const setSort = useCallback(
    (sort: Parameters<typeof setSortRaw>[0]) => setSortRaw(sort, tabId),
    [setSortRaw, tabId]
  )
  const setScrollOffsetRaw = useAppStore((s) => s.setScrollOffset)
  const setScrollOffset = useCallback(
    (offset: number) => setScrollOffsetRaw(offset, tabId),
    [setScrollOffsetRaw, tabId]
  )
  const patchDetailsLayout = useAppStore((s) => s.patchDetailsLayout)
  const search = useAppStore((s) => s.search)
  const recycleBin = useAppStore((s) => s.recycleBin)
  const restoreFromRecycleBinView = useAppStore((s) => s.restoreFromRecycleBinView)
  const focusPane = useAppStore((s) => s.focusPane)
  const paneTabIds = useAppStore((s) => s.paneTabIds)
  const viewLayout = useAppStore((s) => s.viewLayout)
  /** Search / recycle overlays only on the focused pane. */
  const searchMode = search.active && isFocusedSurface
  const recycleMode = recycleBin.active && isFocusedSurface
  const overlayMode = searchMode || recycleMode
  const ensurePaneFocus = useCallback((): void => {
    const idx = paneTabIds.indexOf(tabId)
    if (idx >= 0) focusPane(idx)
  }, [paneTabIds, tabId, focusPane])
  const folderViews = useAppStore((s) => s.settings.folderViews)
  const columnMetaBump = useAppStore((s) => s.columnMetaBump)
  const hideNameExtensions = settings.hideNameExtensions
  const labelFor = (entry: DirEntry): string =>
    entry.kind === 'dir' ? entry.name : displayFileName(entry.name, hideNameExtensions)

  const scrollRef = useRef<HTMLDivElement>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const typeaheadRef = useRef<{ buffer: string; timer: number }>({ buffer: '', timer: 0 })
  const [width, setWidth] = useState(800)
  // Whole-view outline is for multi-pane drop targeting only (single-pane: noise).
  const bgDropActive = !!(
    viewLayout > 1 &&
    dropHighlightPath &&
    listing.path &&
    samePath(dropHighlightPath, listing.path)
  )
  const [marquee, setMarquee] = useState<{ l: number; t: number; w: number; h: number } | null>(
    null
  )
  const suppressClickRef = useRef(false)
  /** Paths with a content thumb (image / video strip) — used to hide names in no-filename view. */
  const contentThumbPaths = useRef(new Map<string, boolean>())
  const [, setContentThumbTick] = useState(0)
  const noteContentThumb = useCallback((filePath: string, has: boolean) => {
    const k = filePath.toLowerCase()
    if (contentThumbPaths.current.get(k) === has) return
    contentThumbPaths.current.set(k, has)
    setContentThumbTick((n) => n + 1)
  }, [])

  // details-view column customization
  const [liveWidths, setLiveWidths] = useState<Record<string, number> | null>(null)
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null)
  const [recycleSort, setRecycleSort] = useState<{
    key: 'name' | RecycleDetailsColId
    dir: 'asc' | 'desc'
  }>({ key: 'dateDeleted', dir: 'desc' })
  const [recycleColWidths, setRecycleColWidths] = useState<Record<string, number>>({})
  const [colDrag, setColDrag] = useState<DetailsColumnId | null>(null)
  const [colDrop, setColDrop] = useState<DetailsColumnId | 'end' | null>(null)
  const [metaByPath, setMetaByPath] = useState<Record<string, EntryColumnValues>>({})

  const folderPath = tab?.path ?? ''
  const owningView = useMemo(
    () => (folderPath ? resolveFolderView(folderPath, folderViews) : null),
    [folderPath, folderViews]
  )
  const detailsColumnsBase = owningView?.detailsColumns ?? settings.detailsColumns
  /** Session-only width for the search Folder column (never written to settings). */
  const [searchFolderWidth, setSearchFolderWidth] = useState(
    DETAILS_COLUMN_META.folder.defaultWidth
  )
  /**
   * Folder column is search-only. Strip any legacy persisted `folder` entry from
   * normal browsing; inject Folder only while search is active.
   */
  const detailsColumns = useMemo(() => {
    const base = detailsColumnsBase.filter((c) => c.id !== 'folder')
    if (!searchMode) return base
    return [{ id: 'folder' as const, width: searchFolderWidth }, ...base]
  }, [searchMode, detailsColumnsBase, searchFolderWidth])
  const detailsNameWidth = owningView?.detailsNameWidth ?? settings.detailsNameWidth
  const effectiveSort = useMemo(
    () => owningView?.sort ?? tab?.sort ?? { key: 'name' as const, dir: 'asc' as const },
    [owningView, tab?.sort]
  )
  const viewMode = owningView?.viewMode ?? tab?.viewMode ?? 'largeIcons'
  const noFilenameView = viewMode === 'extraLargeIconsNoName'

  useEffect(() => {
    contentThumbPaths.current.clear()
    setContentThumbTick((n) => n + 1)
    const ta = typeaheadRef.current
    window.clearTimeout(ta.timer)
    ta.buffer = ''
  }, [folderPath, searchMode, search.results, recycleMode, recycleBin.items])

  const nameColWidth = liveWidths?.['name'] ?? detailsNameWidth
  const colWidth = (id: DetailsColumnId): number =>
    liveWidths?.[id] ??
    detailsColumns.find((c) => c.id === id)?.width ??
    DETAILS_COLUMN_META[id].defaultWidth

  const startColResize = useCallback(
    (e: React.PointerEvent, id: 'name' | DetailsColumnId): void => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const s = useAppStore.getState()
      const owning = resolveFolderView(s.activeTab().path, s.settings.folderViews)
      const cols = owning?.detailsColumns ?? s.settings.detailsColumns
      const nameW = owning?.detailsNameWidth ?? s.settings.detailsNameWidth
      const startW =
        id === 'name'
          ? nameW
          : id === 'folder'
            ? searchFolderWidth
            : (cols.find((c) => c.id === id)?.width ?? DETAILS_COLUMN_META[id].defaultWidth)
      const min = id === 'name' ? 120 : 50
      let w = startW
      const onMove = (ev: PointerEvent): void => {
        w = Math.max(min, Math.min(1200, Math.round(startW + ev.clientX - startX)))
        setLiveWidths({ [id]: w })
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        setLiveWidths(null)
        if (id === 'name') void patchDetailsLayout({ detailsNameWidth: w })
        else if (id === 'folder') setSearchFolderWidth(w)
        else {
          const next = cols
            .filter((c) => c.id !== 'folder')
            .map((c) => (c.id === id ? { ...c, width: w } : c))
          if (!cols.some((c) => c.id === id)) {
            next.push({ id, width: w })
          }
          void patchDetailsLayout({ detailsColumns: next })
        }
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [patchDetailsLayout, searchFolderWidth]
  )

  const moveColumn = useCallback(
    (dragId: DetailsColumnId, target: DetailsColumnId | 'end'): void => {
      // Search Folder column stays pinned first — not part of saved layout.
      if (dragId === 'folder' || target === 'folder') return
      const s = useAppStore.getState()
      const owning = resolveFolderView(s.activeTab().path, s.settings.folderViews)
      const cur = (owning?.detailsColumns ?? s.settings.detailsColumns).filter(
        (c) => c.id !== 'folder'
      )
      const dragged = cur.find((c) => c.id === dragId)
      if (!dragged) return
      const without = cur.filter((c) => c.id !== dragId)
      const idx = target === 'end' ? -1 : without.findIndex((c) => c.id === target)
      const next =
        idx < 0 ? [...without, dragged] : [...without.slice(0, idx), dragged, ...without.slice(idx)]
      void patchDetailsLayout({ detailsColumns: next })
    },
    [patchDetailsLayout]
  )

  const toggleColumn = useCallback(
    (id: DetailsColumnId): void => {
      if (id === 'folder') return
      const s = useAppStore.getState()
      const owning = resolveFolderView(s.activeTab().path, s.settings.folderViews)
      const cur = (owning?.detailsColumns ?? s.settings.detailsColumns).filter(
        (c) => c.id !== 'folder'
      )
      const next = cur.some((c) => c.id === id)
        ? cur.filter((c) => c.id !== id)
        : [...cur, { id, width: DETAILS_COLUMN_META[id].defaultWidth }]
      void patchDetailsLayout({ detailsColumns: next })
    },
    [patchDetailsLayout]
  )

  useEffect(() => {
    if (!headerMenu) return
    const close = (): void => setHeaderMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [headerMenu])

  // Callback ref: the scroll element is not rendered on every code path (empty
  // tab / error states), so a mount-only effect can miss it entirely and leave
  // `width` stuck at its initial value. Attaching here observes whichever
  // element is actually mounted. Transient 0 widths (detach/hide) are ignored.
  const setScrollEl = useCallback((el: HTMLDivElement | null): void => {
    scrollRef.current = el
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) setWidth(el.clientWidth)
    })
    ro.observe(el)
    if (el.clientWidth > 0) setWidth(el.clientWidth)
    resizeObserverRef.current = ro
  }, [])

  const viewFilterOn = settings.viewFilterEnabled
  const viewPatterns = settings.viewFilterPatterns
  const compiledFilter = useMemo(
    () => compileViewFilter(viewPatterns, viewFilterOn),
    [viewPatterns, viewFilterOn]
  )
  const isExcluded = useMemo(
    () => (e: { path: string; isHidden: boolean }) => {
      if (!viewFilterOn) return false
      if (e.isHidden) return true
      return compiledFilter(e.path)
    },
    [viewFilterOn, compiledFilter]
  )
  const asyncColumns = useMemo(
    () => detailsColumns.map((c) => c.id).filter(isAsyncColumn),
    [detailsColumns]
  )

  const recycleByPath = useMemo(() => {
    const m = new Map<string, RecycleBinItem>()
    for (const it of recycleBin.items) m.set(it.originalPath.toLowerCase(), it)
    return m
  }, [recycleBin.items])

  const recycleColWidth = (id: RecycleDetailsColId): number =>
    recycleColWidths[id] ?? RECYCLE_DETAILS_COLS.find((c) => c.id === id)!.width

  const startRecycleColResize = useCallback(
    (e: React.PointerEvent, id: 'name' | RecycleDetailsColId): void => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startW =
        id === 'name'
          ? nameColWidth
          : (recycleColWidths[id] ??
            RECYCLE_DETAILS_COLS.find((c) => c.id === id)!.width)
      const onMove = (ev: PointerEvent): void => {
        const w = Math.max(60, startW + (ev.clientX - startX))
        if (id === 'name') {
          setLiveWidths((prev) => ({ ...(prev ?? {}), name: w }))
        } else {
          setRecycleColWidths((prev) => ({ ...prev, [id]: w }))
        }
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [nameColWidth, recycleColWidths]
  )

  const sourceEntries = useMemo(() => {
    if (recycleMode) {
      if (recycleBin.loading) return []
      return recycleBinItemsToEntries(recycleBin.items)
    }
    if (!searchMode) return listing.entries
    if (search.running) return []
    return searchResultsToEntries(search.results)
  }, [
    recycleMode,
    recycleBin.loading,
    recycleBin.items,
    searchMode,
    search.running,
    search.results,
    listing.entries
  ])

  // Reset / fetch async column metadata when the folder or enabled columns change.
  useEffect(() => {
    setMetaByPath({})
    if (asyncColumns.length === 0) return
    const includeDirs = asyncColumns.includes('ads')
    const files = sourceEntries
      .filter((e) => {
        if (isExcluded(e)) return false
        if (e.kind === 'file') return true
        if (includeDirs && e.kind === 'dir') return true
        return false
      })
      .map((e) => e.path)
    if (files.length === 0) return
    let cancelled = false
    const run = async (): Promise<void> => {
      const chunkSize = 40
      for (let i = 0; i < files.length; i += chunkSize) {
        if (cancelled) return
        const chunk = files.slice(i, i + chunkSize)
        const res = await api.meta.getMany({ paths: chunk, columns: asyncColumns })
        if (cancelled || !res.ok) continue
        setMetaByPath((prev) => ({ ...prev, ...res.value.values }))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [folderPath, sourceEntries, asyncColumns, isExcluded, searchMode, recycleMode])

  // Re-fetch a single path after ADS manager mutations (main cache already invalidated).
  useEffect(() => {
    if (!columnMetaBump.path || asyncColumns.length === 0) return
    const target = columnMetaBump.path
    let cancelled = false
    void (async () => {
      const res = await api.meta.getMany({ paths: [target], columns: asyncColumns })
      if (cancelled || !res.ok) return
      setMetaByPath((prev) => {
        const next = { ...prev }
        const values = res.value.values[target]
        if (values && Object.keys(values).length > 0) next[target] = values
        else delete next[target]
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [columnMetaBump.rev, columnMetaBump.path, asyncColumns])

  const entries = useMemo(() => {
    // Avoid copying 20k entries when the filter cannot hide anything.
    let filtered = sourceEntries
    if (viewFilterOn) {
      if (viewPatterns.length === 0) {
        const hasHidden = sourceEntries.some((e) => e.isHidden)
        if (hasHidden) filtered = sourceEntries.filter((e) => !e.isHidden)
      } else {
        filtered = sourceEntries.filter((e) => !isExcluded(e))
      }
    }
    if (recycleMode) {
      const dirMul = recycleSort.dir === 'asc' ? 1 : -1
      return [...filtered].sort((a, b) => {
        if (settings.foldersFirst) {
          const ad = a.kind === 'dir' ? 0 : 1
          const bd = b.kind === 'dir' ? 0 : 1
          if (ad !== bd) return ad - bd
        }
        let cmp = 0
        if (recycleSort.key === 'name') {
          cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        } else if (recycleSort.key === 'dateDeleted') {
          cmp = (a.mtimeMs || 0) - (b.mtimeMs || 0)
        } else if (recycleSort.key === 'size') {
          cmp = (a.size || 0) - (b.size || 0)
        } else if (recycleSort.key === 'type') {
          cmp = typeLabel(a.ext, a.kind === 'dir').localeCompare(
            typeLabel(b.ext, b.kind === 'dir'),
            undefined,
            { sensitivity: 'base' }
          )
        } else if (recycleSort.key === 'origin') {
          const ao = recycleByPath.get(a.path.toLowerCase())?.deletedFrom ?? ''
          const bo = recycleByPath.get(b.path.toLowerCase())?.deletedFrom ?? ''
          cmp = ao.localeCompare(bo, undefined, { numeric: true, sensitivity: 'base' })
        }
        if (cmp === 0) {
          cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        }
        return cmp * dirMul
      })
    }
    const sort = effectiveSort
    if (SYNC_SORT_KEYS.has(sort.key)) {
      // Normal folder browsing: store keeps listing sorted (loadListing / setSort).
      if (!searchMode) return filtered
      return sortEntries(filtered, sort, settings.foldersFirst)
    }
    const colId = sort.key as DetailsColumnId
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (settings.foldersFirst) {
        const ad = a.kind === 'dir' ? 0 : 1
        const bd = b.kind === 'dir' ? 0 : 1
        if (ad !== bd) return ad - bd
      }
      const av = detailCellValue(colId, a, metaByPath[a.path])
      const bv = detailCellValue(colId, b, metaByPath[b.path])
      let cmp = compareColumnValues(colId, av, bv)
      if (cmp === 0) {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      }
      return cmp * dir
    })
  }, [
    sourceEntries,
    effectiveSort,
    settings.foldersFirst,
    isExcluded,
    viewFilterOn,
    viewPatterns.length,
    metaByPath,
    recycleMode,
    recycleSort,
    recycleByPath,
    searchMode
  ])
  const selected = useMemo(
    () => new Set((tab?.selected ?? []).map((p) => p.toLowerCase())),
    [tab?.selected]
  )
  const cutSet = useMemo(
    () => new Set(clipboard?.mode === 'cut' ? clipboard.paths.map((p) => p.toLowerCase()) : []),
    [clipboard]
  )

  const isGrid = viewMode in GRID_SPECS
  const spec = isGrid ? GRID_SPECS[viewMode as GridMode] : null
  const columns = spec ? Math.max(1, Math.floor(width / spec.cellW)) : 1
  const rowCount = spec ? Math.ceil(entries.length / columns) : entries.length
  const rowHeight = spec ? spec.cellH : 24

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    // Keep a small buffer for scroll smoothness; ThumbImage also gates
    // network/decode work with IntersectionObserver (~180px margin).
    overscan: 2
  })

  // TanStack Virtual caches row sizes and does not re-measure when
  // estimateSize changes (e.g. switching view modes) — force it.
  useLayoutEffect(() => {
    virtualizer.measure()
  }, [rowHeight, columns, virtualizer])

  // Keep the item being renamed in view (new folder/file, F2, etc.).
  useLayoutEffect(() => {
    if (!renamingPath) return
    const idx = entries.findIndex((en) => samePath(en.path, renamingPath))
    if (idx < 0) return
    const rowIdx = spec ? Math.floor(idx / columns) : idx
    virtualizer.scrollToIndex(rowIdx, { align: 'auto' })
  }, [renamingPath, entries, spec, columns, virtualizer])

  // Reveal / open-location: scroll selection into view once the listing has it.
  useLayoutEffect(() => {
    if (!isFocusedSurface || !fileListScrollRequest) return
    const idx = entries.findIndex((en) => samePath(en.path, fileListScrollRequest.path))
    if (idx < 0) return
    const rowIdx = spec ? Math.floor(idx / columns) : idx
    virtualizer.scrollToIndex(rowIdx, { align: 'center' })
    const el = scrollRef.current
    if (el) setScrollOffset(el.scrollTop)
    clearFileListScrollRequest()
  }, [
    isFocusedSurface,
    fileListScrollRequest,
    entries,
    spec,
    columns,
    virtualizer,
    clearFileListScrollRequest,
    setScrollOffset
  ])

  // Explorer-style keyboard navigation: arrows, Home/End, PageUp/Down (+ Shift range),
  // and letter typeahead (next name starting with typed prefix).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Only the focused pane handles window-level file-view keys.
      if (!isFocusedSurface) return
      const s = useAppStore.getState()
      if (
        s.dialog ||
        s.contextMenu ||
        s.imageViewer ||
        s.imageEditor ||
        s.renamingPath ||
        s.addressEditing
      ) {
        return
      }
      if (isEditingTarget(e.target)) return
      if (entries.length === 0) return
      // Don't steal keys while the folder tree / preview has focus.
      if (
        e.target instanceof Element &&
        e.target.closest('.tree, .pane-tree, .preview, .pane-preview')
      ) {
        return
      }

      const focusIdx = ((): number => {
        if (focusedPath) {
          const i = entries.findIndex((en) => samePath(en.path, focusedPath))
          if (i >= 0) return i
        }
        const sel = tab?.selected ?? []
        for (let i = sel.length - 1; i >= 0; i--) {
          const idx = entries.findIndex((en) => samePath(en.path, sel[i]!))
          if (idx >= 0) return idx
        }
        return -1
      })()

      const selectAndScroll = (target: number): void => {
        const targetPath = entries[target]!.path
        setSelection([targetPath], targetPath, targetPath)
        const rowIdx = spec ? Math.floor(target / columns) : target
        virtualizer.scrollToIndex(rowIdx, { align: 'auto' })
      }

      // Typeahead: printable character → next item whose name starts with the buffer.
      if (
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        e.key.length === 1 &&
        e.key !== ' '
      ) {
        // Ignore non-printable / control characters (e.g. Escape is length > 1 anyway).
        if (e.key < ' ' || e.key === '\x7f') return
        e.preventDefault()
        const ta = typeaheadRef.current
        window.clearTimeout(ta.timer)
        const ch = e.key
        if (ta.buffer.length === 1 && ta.buffer.toLocaleLowerCase() === ch.toLocaleLowerCase()) {
          // Same letter again → cycle matches for that letter (Explorer-style).
        } else {
          ta.buffer += ch
        }
        ta.timer = window.setTimeout(() => {
          ta.buffer = ''
        }, TYPEAHEAD_MS)

        const found = findTypeaheadIndex(entries, ta.buffer, focusIdx)
        if (found >= 0) selectAndScroll(found)
        return
      }

      const key = e.key
      const navKeys = new Set([
        'Home',
        'End',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'PageUp',
        'PageDown'
      ])
      if (!navKeys.has(key)) return
      // Leave Alt+arrows to shell back/forward.
      if (e.altKey) return
      // List/details: horizontal arrows unused (reserved for future tree focus).
      if (!spec && (key === 'ArrowLeft' || key === 'ArrowRight')) return

      e.preventDefault()
      typeaheadRef.current.buffer = ''

      const pageRows = Math.max(
        1,
        Math.floor((scrollRef.current?.clientHeight ?? rowHeight * 10) / rowHeight) - 1
      )
      const last = entries.length - 1
      let target = focusIdx

      switch (key) {
        case 'Home':
          target = 0
          break
        case 'End':
          target = last
          break
        case 'ArrowUp':
          if (focusIdx < 0) target = 0
          else target = spec ? Math.max(0, focusIdx - columns) : Math.max(0, focusIdx - 1)
          break
        case 'ArrowDown':
          if (focusIdx < 0) target = 0
          else target = spec ? Math.min(last, focusIdx + columns) : Math.min(last, focusIdx + 1)
          break
        case 'ArrowLeft':
          target = focusIdx < 0 ? 0 : Math.max(0, focusIdx - 1)
          break
        case 'ArrowRight':
          target = focusIdx < 0 ? 0 : Math.min(last, focusIdx + 1)
          break
        case 'PageUp':
          if (focusIdx < 0) target = 0
          else
            target = spec
              ? Math.max(0, focusIdx - pageRows * columns)
              : Math.max(0, focusIdx - pageRows)
          break
        case 'PageDown':
          if (focusIdx < 0) target = 0
          else
            target = spec
              ? Math.min(last, focusIdx + pageRows * columns)
              : Math.min(last, focusIdx + pageRows)
          break
      }

      target = Math.max(0, Math.min(last, target))
      const targetPath = entries[target]!.path

      if (e.shiftKey) {
        const anchorPath = selectionAnchor ?? (focusIdx >= 0 ? entries[focusIdx]!.path : targetPath)
        const anchorIdx = entries.findIndex((en) => samePath(en.path, anchorPath))
        const a = anchorIdx >= 0 ? anchorIdx : target
        const [from, to] = a < target ? [a, target] : [target, a]
        setSelection(
          entries.slice(from, to + 1).map((en) => en.path),
          anchorPath,
          targetPath
        )
        const rowIdx = spec ? Math.floor(target / columns) : target
        virtualizer.scrollToIndex(rowIdx, { align: 'auto' })
      } else {
        selectAndScroll(target)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    isFocusedSurface,
    entries,
    focusedPath,
    tab?.selected,
    selectionAnchor,
    setSelection,
    spec,
    columns,
    rowHeight,
    virtualizer
  ])

  // Layout is deterministic, so marquee hits are pure math over all entries
  // (not just the virtualized ones). Rect is in content coordinates.
  const marqueeHitTest = (l: number, t: number, w: number, h: number): string[] => {
    const r = l + w
    const b = t + h
    const hits: string[] = []
    for (let i = 0; i < entries.length; i++) {
      let x: number, y: number, cw: number, ch: number
      if (spec) {
        x = (i % columns) * spec.cellW
        y = Math.floor(i / columns) * spec.cellH
        cw = spec.cellW - 8
        ch = spec.cellH - 8
      } else {
        x = 0
        y = i * rowHeight
        cw = width
        ch = rowHeight
      }
      if (l < x + cw && r > x && t < y + ch && b > y) hits.push(entries[i]!.path)
    }
    return hits
  }
  const marqueeHitTestRef = useRef(marqueeHitTest)
  useEffect(() => {
    marqueeHitTestRef.current = marqueeHitTest
  })

  const startMarquee = useCallback(
    (e: React.MouseEvent): void => {
      const el = scrollRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      // ignore presses on the scrollbars
      if (e.clientX - rect.left >= el.clientWidth || e.clientY - rect.top >= el.clientHeight)
        return
      e.preventDefault()

      const additive = e.ctrlKey || e.shiftKey
      const base = additive
        ? (useAppStore.getState().tabs.find((t) => t.id === useAppStore.getState().activeTabId)
            ?.selected ?? [])
        : []
      const baseSet = new Set(base.map((p) => p.toLowerCase()))

      const toContent = (cx: number, cy: number): { x: number; y: number } => {
        const r = el.getBoundingClientRect()
        return {
          x: Math.max(0, Math.min(cx - r.left + el.scrollLeft, el.scrollWidth)),
          y: Math.max(0, Math.min(cy - r.top + el.scrollTop, el.scrollHeight))
        }
      }
      const origin = toContent(e.clientX, e.clientY)
      let lastClient = { x: e.clientX, y: e.clientY }
      let active = false
      let raf = 0

      const apply = (): void => {
        const cur = toContent(lastClient.x, lastClient.y)
        const l = Math.min(origin.x, cur.x)
        const t = Math.min(origin.y, cur.y)
        const w = Math.abs(origin.x - cur.x)
        const h = Math.abs(origin.y - cur.y)
        setMarquee({ l, t, w, h })
        const hits = marqueeHitTestRef.current(l, t, w, h)
        const sel = additive ? [...base, ...hits.filter((p) => !baseSet.has(p.toLowerCase()))] : hits
        const focus = hits[hits.length - 1] ?? sel[sel.length - 1] ?? null
        const anchor = additive
          ? (useAppStore.getState().selectionAnchor ?? sel[0] ?? null)
          : (sel[0] ?? null)
        setSelection(sel, anchor, focus)
      }

      const onMove = (ev: MouseEvent): void => {
        lastClient = { x: ev.clientX, y: ev.clientY }
        if (!active) {
          if (Math.abs(ev.clientX - e.clientX) < 4 && Math.abs(ev.clientY - e.clientY) < 4) return
          active = true
        }
        apply()
      }
      // Auto-scroll while the pointer sits near/beyond the top or bottom edge.
      const tick = (): void => {
        if (active) {
          const r = el.getBoundingClientRect()
          let dy = 0
          if (lastClient.y < r.top + 24) dy = -Math.ceil((r.top + 24 - lastClient.y) / 4)
          else if (lastClient.y > r.bottom - 24) dy = Math.ceil((lastClient.y - (r.bottom - 24)) / 4)
          if (dy !== 0) {
            el.scrollTop += dy
            apply()
          }
        }
        raf = requestAnimationFrame(tick)
      }
      const onUp = (): void => {
        cancelAnimationFrame(raf)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setMarquee(null)
        // A plain background click (no drag) clears / keeps the base selection.
        if (!active) setSelection(base, null, null)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      raf = requestAnimationFrame(tick)
    },
    [setSelection]
  )

  // Restore scroll offset when path changes; save on scroll.
  const listingPath = listing.path
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !tab) return
    // Don't clobber a pending reveal scroll (would jump back to 0 on new tabs).
    if (fileListScrollRequest) return
    el.scrollTop = tab.scrollOffset
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingPath, tab?.id, fileListScrollRequest])

  const pendingScrollRef = useRef(0)
  const scrollSaveTimerRef = useRef(0)
  const onScroll = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    // Do not write scrollOffset into Zustand every frame — that re-renders the
    // whole explorer (tabs subscription) and feels like a 20k-file hitch.
    pendingScrollRef.current = el.scrollTop
    if (scrollSaveTimerRef.current) return
    scrollSaveTimerRef.current = window.setTimeout(() => {
      scrollSaveTimerRef.current = 0
      setScrollOffset(pendingScrollRef.current)
    }, 150)
  }, [setScrollOffset])

  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) {
        window.clearTimeout(scrollSaveTimerRef.current)
        scrollSaveTimerRef.current = 0
        setScrollOffset(pendingScrollRef.current)
      }
    }
  }, [setScrollOffset])

  /** Compute the selection that modifiers would produce (sync — needed before drag starts). */
  const selectionForModifiers = useCallback(
    (
      entry: DirEntry,
      mods: { ctrlKey: boolean; shiftKey: boolean }
    ): { paths: string[]; anchor: string; focused: string } => {
      const path = entry.path
      const current = tab?.selected ?? []
      if (mods.ctrlKey) {
        const has = current.some((p) => samePath(p, path))
        const paths = has ? current.filter((p) => !samePath(p, path)) : [...current, path]
        return { paths, anchor: path, focused: path }
      }
      if (mods.shiftKey && selectionAnchor) {
        const anchorIdx = entries.findIndex((en) => samePath(en.path, selectionAnchor))
        const idx = entries.findIndex((en) => samePath(en.path, path))
        if (anchorIdx >= 0 && idx >= 0) {
          const [from, to] = anchorIdx < idx ? [anchorIdx, idx] : [idx, anchorIdx]
          return {
            paths: entries.slice(from, to + 1).map((en) => en.path),
            anchor: selectionAnchor,
            focused: path
          }
        }
      }
      return { paths: [path], anchor: path, focused: path }
    },
    [tab?.selected, selectionAnchor, entries]
  )

  const selectWithModifiers = useCallback(
    (entry: DirEntry, e: React.MouseEvent): void => {
      const next = selectionForModifiers(entry, e)
      setSelection(next.paths, next.anchor, next.focused)
    },
    [selectionForModifiers, setSelection]
  )

  const highlightDropDest = useCallback(
    (dest: string | null): void => {
      setDropHighlight(dest)
    },
    [setDropHighlight]
  )

  const clearDragVisuals = useCallback((): void => {
    setDragPaths([])
    setDropHighlight(null)
  }, [setDragPaths, setDropHighlight])

  const onItemPointerDown = useCallback(
    (entry: DirEntry, e: React.PointerEvent): void => {
      if (recycleMode) return
      if (e.button !== 0 && e.button !== 2) return
      if (renameSource === 'files' && renamingPath !== null && samePath(renamingPath, entry.path)) {
        return
      }

      const alreadySelected = selected.has(entry.path.toLowerCase())

      if (e.button === 2) {
        e.preventDefault()
        e.stopPropagation()
        const dragPathsNow = alreadySelected ? (tab?.selected ?? [entry.path]) : [entry.path]
        if (!alreadySelected) {
          setSelection([entry.path], entry.path, entry.path)
        }
        const ghostLabel =
          dragPathsNow.length === 1 ? basename(dragPathsNow[0]!) : `${dragPathsNow.length} items`
        beginRightDragGesture(
          dragPathsNow,
          e.clientX,
          e.clientY,
          e.currentTarget,
          e.pointerId,
          {
            ghostLabel,
            onActivated: (paths) => setDragPaths(paths),
            onHighlight: highlightDropDest,
            onFinish: ({ active, paths, clientX, clientY, dest }) => {
              clearDragVisuals()
              if (!active) {
                openContextMenu({ x: clientX, y: clientY, paths })
                return
              }
              if (dest) {
                openContextMenu({
                  x: clientX,
                  y: clientY,
                  paths,
                  dropTransfer: { destDir: dest }
                })
              }
            },
            onCancel: () => clearDragVisuals()
          }
        )
        return
      }

      // Left button — Explorer: Shift/Ctrl update selection on press, then the
      // same gesture can drag that set (no release + second click).
      let dragPathsNow: string[]
      if (!e.ctrlKey && !e.shiftKey && alreadySelected) {
        dragPathsNow = tab?.selected ?? [entry.path]
      } else {
        const next = selectionForModifiers(entry, e)
        setSelection(next.paths, next.anchor, next.focused)
        suppressClickRef.current = true
        // Select counts as the first click for Explorer rename timing.
        if (!e.ctrlKey && !e.shiftKey) noteItemClick(entry.path)
        // Ctrl+click toggled this item off — selection-only.
        if (e.ctrlKey && !next.paths.some((p) => samePath(p, entry.path))) return
        dragPathsNow = next.paths
      }

      if (dragPathsNow.length === 0) return

      const ghostLabel =
        dragPathsNow.length === 1 ? basename(dragPathsNow[0]!) : `${dragPathsNow.length} items`

      beginLeftFileDragGesture(
        dragPathsNow,
        e.clientX,
        e.clientY,
        e.currentTarget,
        e.pointerId,
        {
          ghostLabel,
          onActivated: (paths) => {
            cancelDoubleSingleClick()
            setDragPaths(paths)
            suppressClickRef.current = true
          },
          onHighlight: highlightDropDest,
          onDrop: ({ paths, dest, ctrlKey, shiftKey }) => {
            clearDragVisuals()
            const src = paths[0]
            if (!dest || !src) return
            void performTransfer(dropOperation(src, dest, ctrlKey, shiftKey), paths, dest)
          },
          onCancel: () => clearDragVisuals()
        }
      )
    },
    [
      recycleMode,
      renameSource,
      renamingPath,
      selected,
      setSelection,
      selectionForModifiers,
      tab?.selected,
      setDragPaths,
      highlightDropDest,
      clearDragVisuals,
      openContextMenu,
      performTransfer
    ]
  )

  const onItemMouseDown = useCallback(
    (entry: DirEntry, e: React.MouseEvent): void => {
      if (e.button === 2) return // handled by onItemPointerDown
      // Shift/Ctrl selection is applied in pointerdown so the same press can drag.
      if (e.ctrlKey || e.shiftKey) {
        suppressClickRef.current = true
        return
      }
      if (selected.has(entry.path.toLowerCase())) {
        // defer to click so dragging a multi-selection works
        suppressClickRef.current = false
        return
      }
      // Plain click on unselected: selection already set in pointerdown.
      suppressClickRef.current = true
    },
    [selected]
  )

  const onItemClick = useCallback(
    (entry: DirEntry, e: React.MouseEvent): void => {
      if (suppressClickRef.current || shouldSuppressClickAfterLeftDrag()) {
        suppressClickRef.current = false
        return
      }
      if (recycleMode || e.ctrlKey || e.shiftKey) {
        cancelDoubleSingleClick()
        selectWithModifiers(entry, e)
        return
      }
      const sel = tab?.selected ?? []
      const alreadySelected = selected.has(entry.path.toLowerCase())
      const onlyThis =
        alreadySelected && sel.length === 1 && samePath(sel[0]!, entry.path)
      // Explorer: slow second click on the name of a sole-selected item → rename now.
      if (onlyThis && isNameLabelTarget(e.target)) {
        if (tryLabelRenameClick(entry.path)) {
          startRename(entry.path, 'files')
        }
        return
      }
      noteItemClick(entry.path)
      selectWithModifiers(entry, e)
    },
    [recycleMode, selected, tab, selectWithModifiers, startRename]
  )

  const onItemDoubleClick = useCallback(
    (entry: DirEntry): void => {
      cancelDoubleSingleClick()
      if (recycleMode) void restoreFromRecycleBinView([entry.path])
      else void openEntry(entry)
    },
    [recycleMode, restoreFromRecycleBinView, openEntry]
  )

  const onItemContextMenu = useCallback(
    (entry: DirEntry, e: React.MouseEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      cancelDoubleSingleClick()
      if (shouldSuppressContextMenu() || getLiveRightDragSession()) return
      const paths = selected.has(entry.path.toLowerCase()) ? (tab?.selected ?? []) : [entry.path]
      if (!selected.has(entry.path.toLowerCase()))
        setSelection([entry.path], entry.path, entry.path)
      openContextMenu({ x: e.clientX, y: e.clientY, paths })
    },
    [selected, tab?.selected, setSelection, openContextMenu]
  )

  const onItemDragEnd = useCallback((): void => {
    clearDragVisuals()
  }, [clearDragVisuals])

  const onItemDrop = useCallback(
    (entry: DirEntry, e: React.DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      setDropHighlight(null)
      const src = dragPaths[0]
      if (entry.kind !== 'dir' || dragPaths.length === 0 || !src) return
      if (dragPaths.some((p) => samePath(p, entry.path) || isUnderPath(entry.path, p))) return
      void performTransfer(
        dropOperation(src, entry.path, e.ctrlKey, e.shiftKey),
        dragPaths,
        entry.path
      )
      setDragPaths([])
    },
    [dragPaths, performTransfer, setDragPaths, setDropHighlight]
  )

  const onBackgroundDrop = useCallback(
    (e: React.DragEvent): void => {
      e.preventDefault()
      setDropHighlight(null)
      const dest = listing.path
      const src = dragPaths[0]
      if (dragPaths.length === 0 || !src || !dest) return
      // dropping into own folder is a no-op for move
      if (dragPaths.every((p) => samePath(parentOf(p) ?? '', dest)) && !e.ctrlKey) return
      void performTransfer(dropOperation(src, dest, e.ctrlKey, e.shiftKey), dragPaths, dest)
      setDragPaths([])
    },
    [dragPaths, listing.path, performTransfer, setDragPaths, setDropHighlight]
  )

  if (!tab) return <div className="fileview" />

  if (listing.offline) {
    return (
      <div className="fileview">
        <div className="fileview-offline">
          <div className="fileview-offline-title">Offline</div>
          <p className="fileview-offline-path" title={listing.path}>
            {listing.path}
          </p>
          <p className="fileview-offline-hint">
            This folder isn’t available right now — common after reboot while encrypted or network
            drives are still mounting. Checking again every few seconds…
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => void useAppStore.getState().refresh()}
          >
            Retry now
          </button>
        </div>
      </div>
    )
  }

  if (listing.error) {
    return (
      <div className="fileview">
        <div className="fileview-empty">{listing.error}</div>
      </div>
    )
  }

  const renameEditor = (entry: DirEntry): JSX.Element => (
    <RenameInput
      name={entry.name}
      isDir={entry.kind === 'dir'}
      onSubmit={(v) => void submitRename(v)}
      onCancel={cancelRename}
    />
  )

  const toggleRecycleSort = (key: 'name' | RecycleDetailsColId): void => {
    setRecycleSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc'
    }))
  }
  const recycleSortArrow = (key: 'name' | RecycleDetailsColId): string =>
    recycleSort.key === key ? (recycleSort.dir === 'asc' ? ' ▲' : ' ▼') : ''

  const toggleSort = (key: SortKey): void =>
    setSort({
      key,
      dir: effectiveSort.key === key && effectiveSort.dir === 'asc' ? 'desc' : 'asc'
    })
  const sortArrow = (key: SortKey): string =>
    effectiveSort.key === key ? (effectiveSort.dir === 'asc' ? ' ▲' : ' ▼') : ''

  return (
    <div className="fileview-pane">
      {viewMode === 'details' && recycleMode && (
        <div className="details-header">
          <div className="hcell" style={{ width: nameColWidth }}>
            <button className="hlabel" type="button" onClick={() => toggleRecycleSort('name')}>
              Name{recycleSortArrow('name')}
            </button>
            <div
              className="hresize"
              draggable={false}
              onPointerDown={(e) => startRecycleColResize(e, 'name')}
              title="Resize column"
            />
          </div>
          {RECYCLE_DETAILS_COLS.map((c) => (
            <div key={c.id} className="hcell" style={{ width: recycleColWidth(c.id) }}>
              <button className="hlabel" type="button" onClick={() => toggleRecycleSort(c.id)}>
                {c.label}
                {recycleSortArrow(c.id)}
              </button>
              <div
                className="hresize"
                draggable={false}
                onPointerDown={(e) => startRecycleColResize(e, c.id)}
                title="Resize column"
              />
            </div>
          ))}
        </div>
      )}
      {viewMode === 'details' && !recycleMode && (
        <div
          className="details-header"
          onContextMenu={(e) => {
            e.preventDefault()
            setHeaderMenu({ x: e.clientX, y: e.clientY })
          }}
          onDragOver={(e) => {
            if (colDrag && e.target === e.currentTarget) {
              e.preventDefault()
              setColDrop('end')
            }
          }}
          onDrop={(e) => {
            if (colDrag) {
              e.preventDefault()
              moveColumn(colDrag, colDrop ?? 'end')
              setColDrag(null)
              setColDrop(null)
            }
          }}
        >
          <div className="hcell" style={{ width: nameColWidth }}>
            <button className="hlabel" onClick={() => toggleSort('name')}>
              Name{sortArrow('name')}
            </button>
            <div
              className="hresize"
              draggable={false}
              onPointerDown={(e) => startColResize(e, 'name')}
              title="Resize column"
            />
          </div>
          {detailsColumns.map((c) => {
            const meta = DETAILS_COLUMN_META[c.id]
            const pinnedSearchFolder = c.id === 'folder'
            return (
              <div
                key={c.id}
                className={`hcell${colDrop === c.id ? ' drop-before' : ''}`}
                style={{ width: colWidth(c.id) }}
                draggable={!pinnedSearchFolder}
                onDragStart={(e) => {
                  if (pinnedSearchFolder) return
                  setColDrag(c.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/x-mfe-column', c.id)
                }}
                onDragEnd={() => {
                  setColDrag(null)
                  setColDrop(null)
                }}
                onDragOver={(e) => {
                  if (pinnedSearchFolder) return
                  if (colDrag && colDrag !== c.id) {
                    e.preventDefault()
                    e.stopPropagation()
                    setColDrop(c.id)
                  }
                }}
                onDrop={(e) => {
                  if (pinnedSearchFolder) return
                  if (colDrag) {
                    e.preventDefault()
                    e.stopPropagation()
                    moveColumn(colDrag, c.id)
                    setColDrag(null)
                    setColDrop(null)
                  }
                }}
              >
                <button className="hlabel" onClick={() => toggleSort(c.id)}>
                  {meta.label}
                  {sortArrow(c.id)}
                </button>
                <div
                  className="hresize"
                  draggable={false}
                  onPointerDown={(e) => startColResize(e, c.id)}
                  title="Resize column"
                />
              </div>
            )
          })}
        </div>
      )}
      {headerMenu && !recycleMode && (
        <div
          className="context-menu details-columns-menu"
          style={{ left: headerMenu.x, top: headerMenu.y }}
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className="menu-item" disabled>
            <span className="menu-check">✓</span>Name
          </button>
          {COLUMN_GROUP_ORDER.map((group) => {
            const ids = DETAILS_COLUMN_IDS.filter(
              (id) => id !== 'folder' && DETAILS_COLUMN_META[id].group === group
            )
            return (
              <div key={group}>
                <div className="menu-hint">{COLUMN_GROUP_LABELS[group]}</div>
                {ids.map((id) => (
                  <button
                    key={id}
                    className="menu-item"
                    onClick={() => toggleColumn(id)}
                    role="menuitem"
                  >
                    <span className="menu-check">
                      {detailsColumns.some((c) => c.id === id) ? '✓' : ''}
                    </span>
                    {DETAILS_COLUMN_META[id].label}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
      <div
        ref={setScrollEl}
        className={`fileview${isGrid ? ' fileview-icons' : ''}${overlayMode ? ' fileview-search' : ''}${bgDropActive ? ' drop-target' : ''}`}
        data-drag-scroll
        onScroll={onScroll}
        tabIndex={0}
        role={isGrid ? 'grid' : 'listbox'}
        aria-label="Files"
        onMouseDown={(e) => {
          ensurePaneFocus()
          if (e.target === e.currentTarget || (e.target as HTMLElement).dataset['bg'] === '1') {
            if (e.button === 0) startMarquee(e)
            else setSelection([], null, null)
          }
        }}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).dataset['bg'] === '1') {
            e.preventDefault()
            if (shouldSuppressContextMenu() || getLiveRightDragSession()) return
            openContextMenu({ x: e.clientX, y: e.clientY, paths: [] })
          }
        }}
        onDragOver={(e) => {
          if (dragPaths.length > 0 && listing.path) {
            e.preventDefault()
            setDropHighlight(listing.path)
          }
        }}
        onDragLeave={(e) => {
          if (
            e.target === e.currentTarget &&
            dropHighlightPath &&
            listing.path &&
            samePath(dropHighlightPath, listing.path)
          ) {
            setDropHighlight(null)
          }
        }}
        onDrop={onBackgroundDrop}
        data-drop-dir={listing.path}
      >
        {entries.length === 0 && !listing.loading && !search.running && !recycleBin.loading && (
          <div className="fileview-empty" data-bg="1">
            {recycleMode
              ? recycleBin.items.length === 0
                ? 'Recycle Bin is empty'
                : 'All items hidden by view filter'
              : searchMode
                ? search.results.length === 0
                  ? 'No results'
                  : 'All results hidden by view filter'
                : 'This folder is empty'}
          </div>
        )}
        {(search.running || recycleBin.loading) && (
          <div className="fileview-empty" data-bg="1">
            {recycleBin.loading ? 'Loading Recycle Bin…' : 'Searching…'}
          </div>
        )}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }} data-bg="1">
          {virtualizer.getVirtualItems().map((vRow) => {
            if (spec) {
              const start = vRow.index * columns
              const rowEntries = entries.slice(start, start + columns)
              return rowEntries.map((entry, i) => {
                const isSel = selected.has(entry.path.toLowerCase())
                const isFocus = focusedPath !== null && samePath(focusedPath, entry.path)
                const iconPx = Math.min(spec.thumb, 48)
                const hasContentPreview =
                  entry.kind === 'file' &&
                  contentThumbPaths.current.get(entry.path.toLowerCase()) === true
                const hideName = noFilenameView && hasContentPreview
                return (
                  <div
                    key={entry.path}
                    className={`grid-cell${isSel ? ' selected' : ''}${cutSet.has(entry.path.toLowerCase()) ? ' cut' : ''}${entry.isHidden ? ' fs-hidden' : ''}${isFocus ? ' focused' : ''}${dropHighlightPath && samePath(dropHighlightPath, entry.path) ? ' drop-target' : ''}${hideName ? ' no-filename' : ''}${hasContentPreview ? ' has-preview' : ' icon-only'}`}
                    style={{
                      top: vRow.start,
                      left: i * spec.cellW,
                      width: spec.cellW - 8,
                      height: spec.cellH - 8
                    }}
                    {...(entry.kind === 'dir' ? { 'data-drop-dir': entry.path } : {})}
                    draggable={false}
                    onPointerDown={(e) => onItemPointerDown(entry, e)}
                    onMouseDown={(e) => onItemMouseDown(entry, e)}
                    onClick={(e) => onItemClick(entry, e)}
                    onDoubleClick={() => onItemDoubleClick(entry)}
                    onContextMenu={(e) => onItemContextMenu(entry, e)}
                    onDragEnd={onItemDragEnd}
                    onDragOver={(e) => {
                      if (entry.kind === 'dir' && dragPaths.length > 0) {
                        e.preventDefault()
                        e.stopPropagation()
                        setDropHighlight(entry.path)
                      }
                    }}
                    onDragLeave={() => {
                      if (dropHighlightPath && samePath(dropHighlightPath, entry.path)) {
                        setDropHighlight(null)
                      }
                    }}
                    onDrop={(e) => onItemDrop(entry, e)}
                    title={entry.name}
                  >
                    <div className="cell-thumb">
                      {entry.kind === 'file' &&
                      !recycleMode &&
                      (isImageExt(entry.ext) || isVideoExt(entry.ext)) ? (
                        <ThumbImage
                          path={entry.path}
                          mtimeMs={entry.mtimeMs}
                          size={spec.thumb}
                          fallback={<ShellIcon path={entry.path} size={iconPx} />}
                          onHasContent={(has) => noteContentThumb(entry.path, has)}
                        />
                      ) : (
                        <ShellIcon path={entry.path} size={iconPx} isDir={entry.kind === 'dir'} />
                      )}
                    </div>
                    {renameSource === 'files' &&
                    renamingPath !== null &&
                    samePath(renamingPath, entry.path) ? (
                      renameEditor(entry)
                    ) : hideName ? null : (
                      <div className="cell-name">
                        <span className="cell-name-primary" title={entry.path}>
                          {labelFor(entry)}
                        </span>
                        {recycleMode && viewMode !== 'details' ? (
                          <span className="cell-name-path" title={entry.path}>
                            {entry.path}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </div>
                )
              })
            }

            const entry = entries[vRow.index]
            if (!entry) return null
            const isSel = selected.has(entry.path.toLowerCase())
            const isFocus = focusedPath !== null && samePath(focusedPath, entry.path)
            return (
              <div
                key={entry.path}
                className={`row${isSel ? ' selected' : ''}${cutSet.has(entry.path.toLowerCase()) ? ' cut' : ''}${entry.isHidden ? ' fs-hidden' : ''}${isFocus ? ' focused' : ''}${dropHighlightPath && samePath(dropHighlightPath, entry.path) ? ' drop-target' : ''}`}
                style={{ top: vRow.start, height: rowHeight }}
                {...(entry.kind === 'dir' ? { 'data-drop-dir': entry.path } : {})}
                draggable={false}
                onPointerDown={(e) => onItemPointerDown(entry, e)}
                onMouseDown={(e) => onItemMouseDown(entry, e)}
                onClick={(e) => onItemClick(entry, e)}
                onDoubleClick={() => onItemDoubleClick(entry)}
                onContextMenu={(e) => onItemContextMenu(entry, e)}
                onDragEnd={onItemDragEnd}
                onDragOver={(e) => {
                  if (entry.kind === 'dir' && dragPaths.length > 0) {
                    e.preventDefault()
                    e.stopPropagation()
                    setDropHighlight(entry.path)
                  }
                }}
                onDragLeave={() => {
                  if (dropHighlightPath && samePath(dropHighlightPath, entry.path)) {
                    setDropHighlight(null)
                  }
                }}
                onDrop={(e) => onItemDrop(entry, e)}
              >
                <div
                  className="row-name"
                  style={
                    viewMode === 'details' ? { width: nameColWidth, flex: '0 0 auto' } : undefined
                  }
                >
                  <ShellIcon path={entry.path} size={16} isDir={entry.kind === 'dir'} />
                  {renameSource === 'files' &&
                  renamingPath !== null &&
                  samePath(renamingPath, entry.path)
                    ? renameEditor(entry)
                    : (
                        <span className="row-name-text" title={entry.path}>
                          <span className="cell-name-primary">{labelFor(entry)}</span>
                          {recycleMode && viewMode !== 'details' ? (
                            <span className="cell-name-path" title={entry.path}>
                              {entry.path}
                            </span>
                          ) : null}
                        </span>
                      )}
                </div>
                {viewMode === 'details' &&
                  recycleMode &&
                  RECYCLE_DETAILS_COLS.map((c) => {
                    const item = recycleByPath.get(entry.path.toLowerCase())
                    const text = recycleDetailCellValue(c.id, entry, item)
                    return (
                      <span
                        key={c.id}
                        className={`col${c.numeric ? ' col-num' : ''}`}
                        style={{ width: recycleColWidth(c.id) }}
                        title={text || undefined}
                      >
                        {text}
                      </span>
                    )
                  })}
                {viewMode === 'details' &&
                  !recycleMode &&
                  detailsColumns.map((c) => (
                    <span
                      key={c.id}
                      className={`col${DETAILS_COLUMN_META[c.id].numeric ? ' col-num' : ''}`}
                      style={{ width: colWidth(c.id) }}
                      title={detailCellValue(c.id, entry, metaByPath[entry.path]) || undefined}
                    >
                      {detailCellValue(c.id, entry, metaByPath[entry.path])}
                    </span>
                  ))}
              </div>
            )
          })}
        </div>
        {marquee && marquee.w + marquee.h > 0 && (
          <div
            className="marquee"
            style={{ left: marquee.l, top: marquee.t, width: marquee.w, height: marquee.h }}
          />
        )}
      </div>
    </div>
  )
}

