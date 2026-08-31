import { create } from 'zustand'
import type {
  PairCompareOptions,
  PairCompareRow,
  PairCompareStatus,
  PairComparisonResult,
  PairSyncDirection,
  PairSyncPlan,
  PairSyncPolicy
} from '@shared/pairCompare/types'
import { defaultPairFoldersSettings, pairFoldersVisibleStatuses } from '@shared/schemas/pairFolders'
import { api, call } from '../lib/ipc'
import { useAppStore } from '../store/appStore'

export type PairPaneRestore = {
  path: string
  viewMode: string
  sort: { key: string; dir: 'asc' | 'desc' }
  selectedPaths: string[]
  scrollOffset: number
}

type PairCompareUiState = {
  active: boolean
  scanning: boolean
  sessionId: string | null
  result: PairComparisonResult | null
  stale: boolean
  progressLabel: string | null
  selectedRowIds: Set<string>
  lastClickedSide: 'left' | 'right' | null
  visibleStatuses: Set<PairCompareStatus>
  sortKey:
    | 'relativePath'
    | 'status'
    | 'name'
    | 'leftModified'
    | 'rightModified'
    | 'leftSize'
    | 'rightSize'
    | 'sizeDiff'
  sortDir: 'asc' | 'desc'
  scrollOffset: number
  expandedFolders: Set<string>
  options: PairCompareOptions
  showOptions: boolean
  hoverDirection: 'ltr' | 'rtl' | null
  leftRestore: PairPaneRestore | null
  rightRestore: PairPaneRestore | null
  leftTabId: string | null
  rightTabId: string | null
  syncPlan: PairSyncPlan | null

  setHoverDirection(dir: 'ltr' | 'rtl' | null): void
  setShowOptions(v: boolean): void
  patchOptions(p: Partial<PairCompareOptions>): void
  setScrollOffset(y: number): void
  toggleExpand(relativePath: string): void
  setVisibleStatuses(statuses: Set<PairCompareStatus>): void
  /** Apply filter without writing settings (boot / layout restore). */
  applyVisibleStatuses(statuses: Iterable<PairCompareStatus>): void
  selectRows(ids: string[], side?: 'left' | 'right'): void
  toggleRow(id: string, side: 'left' | 'right', additive: boolean): void
  clearSelection(): void
  selectByStatus(status: PairCompareStatus | 'differences'): void
  setSort(key: PairCompareUiState['sortKey'], dir?: 'asc' | 'desc'): void
  markStale(): void
  exitComparison(): Promise<void>
  startCompare(): Promise<void>
  cancelCompare(): Promise<void>
  openSyncPlan(direction: PairSyncDirection, policy?: PairSyncPolicy): Promise<void>
  clearSyncPlan(): void
  applyProgress(event: {
    sessionId: string
    phase: string
    itemsScanned: number
    currentRelativePath?: string
    filesHashed?: number
    bytesHashed?: number
  }): void
}

function loadVisibleFromSettings(): Set<PairCompareStatus> {
  const pf =
    useAppStore.getState().settings?.pairFolders ?? defaultPairFoldersSettings
  return new Set(pairFoldersVisibleStatuses(pf) as PairCompareStatus[])
}

function persistVisibleStatuses(statuses: Set<PairCompareStatus>): void {
  const app = useAppStore.getState()
  if (!app.settings) return
  void app.applySettingsPatch({
    pairFolders: {
      visibleStatuses: [...statuses],
      showIdenticalByDefault: statuses.has('identical')
    }
  })
}

function defaultOptionsFromSettings(): PairCompareOptions {
  // Store may init before boot() fills settings (starts as null).
  const pf =
    useAppStore.getState().settings?.pairFolders ?? defaultPairFoldersSettings
  return {
    includeSubfolders: pf.includeSubfolders,
    followLinks: pf.followLinks,
    includeHidden: false,
    compareMethod: pf.compareMethod,
    modifiedToleranceMs: pf.modifiedToleranceMs,
    ignoreEmptyFolders: pf.ignoreEmptyFolders,
    caseSensitive: 'auto'
  }
}

function captureRestore(tabId: string | null): PairPaneRestore | null {
  if (!tabId) return null
  const tab = useAppStore.getState().tabs.find((t) => t.id === tabId)
  if (!tab) return null
  return {
    path: tab.path,
    viewMode: tab.viewMode,
    sort: { ...tab.sort },
    selectedPaths: [...tab.selected],
    scrollOffset: tab.scrollOffset
  }
}

export type VisiblePairRowsInput = Pick<
  PairCompareUiState,
  'result' | 'visibleStatuses' | 'sortKey' | 'sortDir'
>

export function visiblePairRows(state: VisiblePairRowsInput): PairCompareRow[] {
  if (!state.result) return []
  let rows = state.result.rows.filter((r) => state.visibleStatuses.has(r.status))
  const dir = state.sortDir === 'asc' ? 1 : -1
  const nameOf = (r: PairCompareRow): string => {
    const base = r.relativePath.replace(/\\/g, '/')
    const i = base.lastIndexOf('/')
    return i >= 0 ? base.slice(i + 1) : base
  }
  rows = [...rows].sort((a, b) => {
    let cmp: number
    switch (state.sortKey) {
      case 'status':
        cmp = a.status.localeCompare(b.status)
        break
      case 'name':
        cmp = nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' })
        break
      case 'leftModified':
        cmp = (a.left?.modifiedMs ?? 0) - (b.left?.modifiedMs ?? 0)
        break
      case 'rightModified':
        cmp = (a.right?.modifiedMs ?? 0) - (b.right?.modifiedMs ?? 0)
        break
      case 'leftSize':
        cmp = (a.left?.size ?? 0) - (b.left?.size ?? 0)
        break
      case 'rightSize':
        cmp = (a.right?.size ?? 0) - (b.right?.size ?? 0)
        break
      case 'sizeDiff':
        cmp =
          Math.abs((a.left?.size ?? 0) - (a.right?.size ?? 0)) -
          Math.abs((b.left?.size ?? 0) - (b.right?.size ?? 0))
        break
      default:
        cmp = a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: 'base' })
    }
    return cmp * dir
  })
  return rows
}

export const usePairCompareStore = create<PairCompareUiState>((set, get) => ({
  active: false,
  scanning: false,
  sessionId: null,
  result: null,
  stale: false,
  progressLabel: null,
  selectedRowIds: new Set(),
  lastClickedSide: null,
  visibleStatuses: loadVisibleFromSettings(),
  sortKey: 'relativePath',
  sortDir: 'asc',
  scrollOffset: 0,
  expandedFolders: new Set(),
  options: defaultOptionsFromSettings(),
  showOptions: false,
  hoverDirection: null,
  leftRestore: null,
  rightRestore: null,
  leftTabId: null,
  rightTabId: null,
  syncPlan: null,

  setHoverDirection(dir) {
    set({ hoverDirection: dir })
  },
  setShowOptions(v) {
    set({ showOptions: v })
  },
  patchOptions(p) {
    set({ options: { ...get().options, ...p } })
  },
  setScrollOffset(y) {
    set({ scrollOffset: y })
  },
  toggleExpand(relativePath) {
    const next = new Set(get().expandedFolders)
    if (next.has(relativePath)) next.delete(relativePath)
    else next.add(relativePath)
    set({ expandedFolders: next })
  },
  setVisibleStatuses(statuses) {
    const next = new Set(statuses)
    set({ visibleStatuses: next })
    persistVisibleStatuses(next)
  },
  applyVisibleStatuses(statuses) {
    set({ visibleStatuses: new Set(statuses) })
  },
  selectRows(ids, side) {
    set({
      selectedRowIds: new Set(ids),
      lastClickedSide: side ?? get().lastClickedSide
    })
  },
  toggleRow(id, side, additive) {
    const next = additive ? new Set(get().selectedRowIds) : new Set<string>()
    if (additive && next.has(id)) next.delete(id)
    else next.add(id)
    set({ selectedRowIds: next, lastClickedSide: side })
  },
  clearSelection() {
    set({ selectedRowIds: new Set(), lastClickedSide: null })
  },
  selectByStatus(status) {
    const rows = get().result?.rows ?? []
    const ids =
      status === 'differences'
        ? rows.filter((r) => r.status !== 'identical').map((r) => r.id)
        : rows.filter((r) => r.status === status).map((r) => r.id)
    set({ selectedRowIds: new Set(ids) })
  },
  setSort(key, dir) {
    const cur = get()
    if (dir) set({ sortKey: key, sortDir: dir })
    else if (cur.sortKey === key) set({ sortDir: cur.sortDir === 'asc' ? 'desc' : 'asc' })
    else set({ sortKey: key, sortDir: 'asc' })
  },
  markStale() {
    if (get().active) set({ stale: true })
  },

  async exitComparison() {
    const s = get()
    if (s.sessionId) {
      try {
        await call(api.pairCompare.dispose({ sessionId: s.sessionId }))
      } catch {
        /* ignore */
      }
    }
    set({
      active: false,
      scanning: false,
      sessionId: null,
      result: null,
      stale: false,
      progressLabel: null,
      selectedRowIds: new Set(),
      scrollOffset: 0,
      syncPlan: null,
      showOptions: false,
      leftRestore: null,
      rightRestore: null,
      leftTabId: null,
      rightTabId: null
    })
  },

  async startCompare() {
    const app = useAppStore.getState()
    if (app.viewLayout !== 2) return
    const leftTabId = app.paneTabIds[0] ?? null
    const rightTabId = app.paneTabIds[1] ?? null
    const leftTab = leftTabId ? app.tabs.find((t) => t.id === leftTabId) : undefined
    const rightTab = rightTabId ? app.tabs.find((t) => t.id === rightTabId) : undefined
    if (!leftTab || !rightTab) {
      app.notify('Both panes need a folder', true)
      return
    }

    const prev = get()
    if (prev.sessionId) {
      try {
        await call(api.pairCompare.dispose({ sessionId: prev.sessionId }))
      } catch {
        /* ignore */
      }
    }

    const options: PairCompareOptions = {
      ...get().options,
      includeHidden: false
    }
    // Persist last-used options into settings (best-effort); keep compare filter as-is.
    if (app.settings) {
      void app.applySettingsPatch({
        pairFolders: {
          includeSubfolders: options.includeSubfolders,
          followLinks: options.followLinks,
          compareMethod: options.compareMethod,
          modifiedToleranceMs: options.modifiedToleranceMs,
          ignoreEmptyFolders: options.ignoreEmptyFolders,
          showIdenticalByDefault: get().visibleStatuses.has('identical'),
          visibleStatuses: [...get().visibleStatuses]
        }
      })
    }

    set({
      active: true,
      scanning: true,
      result: null,
      stale: false,
      progressLabel: 'Comparing…',
      showOptions: false,
      selectedRowIds: new Set(),
      leftRestore: captureRestore(leftTabId),
      rightRestore: captureRestore(rightTabId),
      leftTabId,

      rightTabId,
      options
    })

    try {
      const { sessionId } = await call(
        api.pairCompare.start({
          leftRoot: leftTab.path,
          rightRoot: rightTab.path,
          options
        })
      )
      set({ sessionId })
      const result = await call(api.pairCompare.result({ sessionId }))
      if (get().sessionId !== sessionId) return
      set({
        result,
        scanning: false,
        progressLabel: null,
        active: true
      })
      app.notify(
        `Compared ${result.rows.length.toLocaleString()} items` +
          (result.incomplete ? ' (incomplete scan)' : '')
      )
    } catch (e) {
      set({ scanning: false, progressLabel: null, active: false, sessionId: null })
      app.notify(e instanceof Error ? e.message : 'Compare failed', true)
    }
  },

  async cancelCompare() {
    const id = get().sessionId
    if (!id) return
    try {
      await call(api.pairCompare.cancel({ sessionId: id }))
    } catch {
      /* ignore */
    }
    set({ scanning: false, progressLabel: null, active: false, result: null, sessionId: null })
  },

  async openSyncPlan(direction, policy = 'update') {
    const s = get()
    if (!s.sessionId || !s.result) {
      useAppStore.getState().notify('Run Compare first', true)
      return
    }
    const selected = [...s.selectedRowIds]
    const scope = selected.length > 0 ? 'selected' : 'visible'
    try {
      const plan = await call(
        api.pairCompare.buildPlan({
          sessionId: s.sessionId,
          direction,
          policy,
          scope,
          selectedRowIds: selected,
          visibleStatuses: [...s.visibleStatuses]
        })
      )
      set({ syncPlan: plan })
      useAppStore.getState().openDialog({ kind: 'pair-sync-plan' })
    } catch (e) {
      useAppStore.getState().notify(e instanceof Error ? e.message : 'Could not build plan', true)
    }
  },

  clearSyncPlan() {
    set({ syncPlan: null })
  },

  applyProgress(event) {
    if (get().sessionId && event.sessionId !== get().sessionId) return
    if (event.phase === 'cancelled') {
      set({ scanning: false, progressLabel: null })
      return
    }
    if (event.phase === 'hash') {
      set({
        progressLabel: `Hashing… ${event.filesHashed ?? 0} files · ${event.currentRelativePath ?? ''}`
      })
      return
    }
    if (event.phase === 'discover') {
      set({
        progressLabel: `Comparing… ${event.itemsScanned.toLocaleString()} · ${event.currentRelativePath ?? ''}`
      })
    }
  }
}))
