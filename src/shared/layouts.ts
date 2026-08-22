import { z } from 'zod'
import {
  MAX_TREE_EXPANDED,
  sortSchema,
  splittersSchema,
  tabIconSchema,
  viewLayoutSchema,
  viewModeSchema,
  coerceViewLayout,
  sanitizePaneTreeCollapsed,
  type SortSpec,
  type Splitters,
  type TabIcon,
  type ViewLayout,
  type ViewMode
} from './schemas/session'

export const MAX_LAYOUTS = 50
export const MAX_LAYOUT_NAME_LEN = 80

export const layoutTabSchema = z.object({
  path: z.string().min(1),
  title: z.string().nullable().catch(null),
  icon: tabIconSchema,
  viewMode: viewModeSchema.catch('largeIcons'),
  sort: sortSchema.catch({ key: 'name', dir: 'asc' }),
  rootPath: z.string().nullable().catch(null),
  treeExpanded: z
    .array(z.string())
    .catch([])
    .transform((arr) =>
      arr.filter((p) => typeof p === 'string' && p.length > 0).slice(0, MAX_TREE_EXPANDED)
    )
})
export type LayoutTab = z.infer<typeof layoutTabSchema>

function clampRatio(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.min(0.85, Math.max(0.15, n))
}

export const workspaceLayoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(MAX_LAYOUT_NAME_LEN),
  updatedAt: z.string().catch(() => new Date().toISOString()),
  activeTabIndex: z.number().int().min(0).catch(0),
  splitters: splittersSchema.catch({
    treeWidthPx: 240,
    previewWidthPx: 320,
    treeCollapsed: false,
    previewCollapsed: false
  }),
  viewLayout: viewLayoutSchema.catch(1),
  /** Index into `tabs`, or null for empty pane. Length matches viewLayout. */
  paneTabIndexes: z.array(z.number().int().min(0).nullable()).catch([]),
  /** Per-pane folder-tree collapsed (length matches viewLayout). */
  paneTreeCollapsed: z.array(z.boolean()).catch([]),
  paneSplitCols: z.number().min(0.15).max(0.85).catch(0.5),
  paneSplitRows: z.number().min(0.15).max(0.85).catch(0.5),
  tabs: z.array(layoutTabSchema).min(1)
})
export type WorkspaceLayout = z.infer<typeof workspaceLayoutSchema>

/** Snapshot input from the live session (tabs already validated by the store). */
export type LayoutSnapshotSource = {
  tabs: Array<{
    path: string
    title: string | null
    icon: TabIcon
    viewMode: ViewMode
    sort: SortSpec
    rootPath: string | null
    treeExpanded: string[]
  }>
  activeTabIndex: number
  splitters: Splitters
  viewLayout: ViewLayout
  /** Parallel to panes; tab id or null — converted to indexes on capture. */
  paneTabIds: (string | null)[]
  paneTreeCollapsed: boolean[]
  paneSplitCols: number
  paneSplitRows: number
  /** Live tab ids in the same order as `tabs` for index mapping. */
  tabIds: string[]
}

export function newLayoutId(): string {
  return `layout_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function sanitizeLayoutName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_LAYOUT_NAME_LEN)
  return name.length > 0 ? name : null
}

export function captureLayoutTabs(source: LayoutSnapshotSource['tabs']): LayoutTab[] {
  return source.map((t) =>
    layoutTabSchema.parse({
      path: t.path,
      title: t.title,
      icon: t.icon,
      viewMode: t.viewMode,
      sort: t.sort,
      rootPath: t.rootPath,
      treeExpanded: t.treeExpanded
    })
  )
}

function paneTabIdsToIndexes(
  paneTabIds: (string | null)[],
  tabIds: string[],
  layout: ViewLayout
): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < layout; i++) {
    const id = paneTabIds[i]
    if (!id) {
      out.push(null)
      continue
    }
    const idx = tabIds.indexOf(id)
    out.push(idx >= 0 ? idx : null)
  }
  return out
}

export function buildLayoutFromSnapshot(
  name: string,
  source: LayoutSnapshotSource,
  existingId?: string
): WorkspaceLayout {
  const cleanName = sanitizeLayoutName(name)
  if (!cleanName) throw new Error('Layout name is required')
  if (source.tabs.length === 0) throw new Error('Layout needs at least one tab')
  const tabs = captureLayoutTabs(source.tabs)
  const activeTabIndex = Math.min(Math.max(0, source.activeTabIndex), tabs.length - 1)
  const viewLayout = coerceViewLayout(source.viewLayout)
  return workspaceLayoutSchema.parse({
    id: existingId ?? newLayoutId(),
    name: cleanName,
    updatedAt: new Date().toISOString(),
    activeTabIndex,
    splitters: source.splitters,
    viewLayout,
    paneTabIndexes: paneTabIdsToIndexes(source.paneTabIds, source.tabIds, viewLayout),
    paneTreeCollapsed: sanitizePaneTreeCollapsed(source.paneTreeCollapsed, viewLayout),
    paneSplitCols: clampRatio(source.paneSplitCols),
    paneSplitRows: clampRatio(source.paneSplitRows),
    tabs
  })
}

export function upsertLayout(list: WorkspaceLayout[], layout: WorkspaceLayout): WorkspaceLayout[] {
  const without = list.filter((l) => l.id !== layout.id)
  const next = [...without, layout]
  if (next.length <= MAX_LAYOUTS) return next
  // Drop oldest by updatedAt (keep the one we just upserted).
  const sorted = [...next].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  const dropIds = new Set(
    sorted
      .filter((l) => l.id !== layout.id)
      .slice(0, next.length - MAX_LAYOUTS)
      .map((l) => l.id)
  )
  return next.filter((l) => !dropIds.has(l.id))
}

export function removeLayout(list: WorkspaceLayout[], id: string): WorkspaceLayout[] {
  return list.filter((l) => l.id !== id)
}

export function renameLayout(
  list: WorkspaceLayout[],
  id: string,
  name: string
): WorkspaceLayout[] | null {
  const clean = sanitizeLayoutName(name)
  if (!clean) return null
  let found = false
  const next = list.map((l) => {
    if (l.id !== id) return l
    found = true
    return { ...l, name: clean, updatedAt: new Date().toISOString() }
  })
  return found ? next : null
}

export function layoutSummary(layout: WorkspaceLayout): string {
  const n = layout.tabs.length
  const titles = layout.tabs
    .slice(0, 3)
    .map((t) => {
      if (t.title?.trim()) return t.title.trim()
      const base = t.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
      return base || t.path
    })
  const more = n > 3 ? ` +${n - 3}` : ''
  const panes = layout.viewLayout > 1 ? ` · ${layout.viewLayout}-pane` : ''
  return `${n} tab${n === 1 ? '' : 's'}${panes}: ${titles.join(', ')}${more}`
}

export function formatLayoutUpdatedAt(iso: string): string {
  const d = Date.parse(iso)
  if (!Number.isFinite(d)) return ''
  try {
    return new Date(d).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  } catch {
    return ''
  }
}
