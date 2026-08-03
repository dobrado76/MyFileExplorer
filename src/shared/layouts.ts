import { z } from 'zod'
import {
  MAX_TREE_EXPANDED,
  sortSchema,
  splittersSchema,
  viewModeSchema,
  type SortSpec,
  type Splitters,
  type ViewMode
} from './schemas/session'

export const MAX_LAYOUTS = 50
export const MAX_LAYOUT_NAME_LEN = 80

export const layoutTabSchema = z.object({
  path: z.string().min(1),
  title: z.string().nullable().catch(null),
  viewMode: viewModeSchema.catch('largeIcons'),
  sort: sortSchema.catch({ key: 'name', dir: 'asc' }),
  rootPath: z.string().nullable().catch(null),
  treeExpanded: z
    .array(z.string())
    .catch([])
    .transform((arr) => arr.filter((p) => typeof p === 'string' && p.length > 0).slice(0, MAX_TREE_EXPANDED))
})
export type LayoutTab = z.infer<typeof layoutTabSchema>

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
  tabs: z.array(layoutTabSchema).min(1)
})
export type WorkspaceLayout = z.infer<typeof workspaceLayoutSchema>

/** Snapshot input from the live session (tabs already validated by the store). */
export type LayoutSnapshotSource = {
  tabs: Array<{
    path: string
    title: string | null
    viewMode: ViewMode
    sort: SortSpec
    rootPath: string | null
    treeExpanded: string[]
  }>
  activeTabIndex: number
  splitters: Splitters
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
      viewMode: t.viewMode,
      sort: t.sort,
      rootPath: t.rootPath,
      treeExpanded: t.treeExpanded
    })
  )
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
  return workspaceLayoutSchema.parse({
    id: existingId ?? newLayoutId(),
    name: cleanName,
    updatedAt: new Date().toISOString(),
    activeTabIndex,
    splitters: source.splitters,
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
  return `${n} tab${n === 1 ? '' : 's'}: ${titles.join(', ')}${more}`
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
