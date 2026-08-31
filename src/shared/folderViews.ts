import type { ViewMode, SortSpec } from './schemas/session'
import type { DetailsColumnId } from './schemas/columns'
import { isUnderPath, pathKey, pathSpecificity, samePath } from './paths'
import {
  isVirtualFolderDocumentPath,
  virtualFolderOpenCwdPath
} from './virtualFolder'

export const MAX_FOLDER_VIEWS = 200

export type FolderView = {
  path: string
  recursive: boolean
  viewMode: ViewMode
  sort: SortSpec
  detailsColumns: { id: DetailsColumnId; width: number }[]
  detailsNameWidth: number
}

/** Path key for folder-view lookup: embedded VF group cwd when drilled in, else tab.path. */
export function folderViewResolvePath(tab: {
  path: string
  virtualFolderGroupStack?: string[]
}): string {
  const stack = tab.virtualFolderGroupStack ?? []
  if (isVirtualFolderDocumentPath(tab.path) && stack.length > 0) {
    return virtualFolderOpenCwdPath(tab.path, stack[stack.length - 1]!)
  }
  return tab.path
}

/** Prefer group customization when browsing a VF group; fall back to the document entry. */
export function resolveFolderViewForTab(
  tab: { path: string; virtualFolderGroupStack?: string[] },
  list: FolderView[]
): FolderView | null {
  const cwd = folderViewResolvePath(tab)
  const hit = resolveFolderView(cwd, list)
  if (hit) return hit
  if (cwd !== tab.path) return resolveFolderView(tab.path, list)
  return null
}

/** Exact match first; else longest recursive ancestor. */
export function resolveFolderView(path: string, list: FolderView[]): FolderView | null {
  if (!path || list.length === 0) return null
  let exact: FolderView | null = null
  let bestAncestor: FolderView | null = null
  let bestSpec = -1
  for (const entry of list) {
    if (samePath(entry.path, path)) {
      exact = entry
      break
    }
    if (entry.recursive && isUnderPath(path, entry.path)) {
      const spec = pathSpecificity(entry.path)
      if (spec > bestSpec) {
        bestSpec = spec
        bestAncestor = entry
      }
    }
  }
  return exact ?? bestAncestor
}

export function findExactFolderView(path: string, list: FolderView[]): FolderView | null {
  return list.find((e) => samePath(e.path, path)) ?? null
}

export function upsertFolderView(list: FolderView[], entry: FolderView): FolderView[] {
  const key = pathKey(entry.path)
  const without = list.filter((e) => pathKey(e.path) !== key)
  const next = [...without, { ...entry, path: entry.path }]
  if (next.length <= MAX_FOLDER_VIEWS) return next
  // Drop oldest-looking entries that aren't the one we just upserted (keep newest path last).
  return next.slice(next.length - MAX_FOLDER_VIEWS)
}

export function removeFolderView(list: FolderView[], path: string): FolderView[] {
  const key = pathKey(path)
  return list.filter((e) => pathKey(e.path) !== key)
}

export function patchFolderView(
  list: FolderView[],
  path: string,
  patch: Partial<Omit<FolderView, 'path'>>
): FolderView[] {
  const key = pathKey(path)
  return list.map((e) => (pathKey(e.path) === key ? { ...e, ...patch } : e))
}

export function folderViewSummary(entry: FolderView): string {
  const mode =
    entry.viewMode === 'extraLargeIconsNoName'
      ? 'Extra large icons only, no filename'
      : entry.viewMode === 'extraLargeIcons'
        ? 'Extra large icons'
        : entry.viewMode === 'largeIcons'
          ? 'Large icons'
          : entry.viewMode === 'mediumIcons'
            ? 'Medium icons'
            : entry.viewMode === 'smallIcons'
              ? 'Small icons'
              : entry.viewMode === 'list'
                ? 'List'
                : 'Details'
  const sortLabel = entry.sort.key === 'name' ? 'Name' : entry.sort.key
  return `${mode} · ${sortLabel}`
}
