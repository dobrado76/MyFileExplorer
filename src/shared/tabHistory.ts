/** Per-tab navigation locations — folder or a WFE-style search. */

export type FolderHistoryEntry = { kind: 'folder'; path: string }

export type SearchHistoryEntry = {
  kind: 'search'
  query: string
  scopePath: string
  indexedOnly: boolean
}

export type HistoryEntry = FolderHistoryEntry | SearchHistoryEntry

export function folderHistory(path: string): FolderHistoryEntry {
  return { kind: 'folder', path }
}

export function searchHistory(
  query: string,
  scopePath: string,
  indexedOnly: boolean
): SearchHistoryEntry {
  return { kind: 'search', query, scopePath, indexedOnly }
}

export function historyLocationPath(entry: HistoryEntry): string {
  return entry.kind === 'folder' ? entry.path : entry.scopePath
}

export function historyEntryKey(entry: HistoryEntry): string {
  if (entry.kind === 'folder') return `folder:${entry.path.toLowerCase()}`
  return `search:${entry.indexedOnly ? '1' : '0'}:${entry.scopePath.toLowerCase()}:${entry.query.toLowerCase()}`
}

export function historyEntryLabel(entry: HistoryEntry): string {
  if (entry.kind === 'folder') {
    const parts = entry.path.replace(/[\\/]+$/, '').split(/[\\/]/)
    return parts[parts.length - 1] || entry.path
  }
  const q = entry.query.trim() || 'Search'
  return `Search: ${q}`
}

export function sameHistoryEntry(a: HistoryEntry, b: HistoryEntry): boolean {
  return historyEntryKey(a) === historyEntryKey(b)
}

export function rewriteHistoryEntry(entry: HistoryEntry, rewrite: (path: string) => string): HistoryEntry {
  if (entry.kind === 'folder') return { kind: 'folder', path: rewrite(entry.path) }
  return { ...entry, scopePath: rewrite(entry.scopePath) }
}

export function persistHistoryEntry(entry: HistoryEntry): HistoryEntry {
  if (entry.kind === 'folder') return { kind: 'folder', path: entry.path }
  return {
    kind: 'search',
    query: entry.query,
    scopePath: entry.scopePath,
    indexedOnly: entry.indexedOnly
  }
}

/** Coerce a persisted session value (legacy path string or tagged object). */
export function coerceHistoryEntry(raw: unknown): HistoryEntry | null {
  if (typeof raw === 'string' && raw.length > 0) return { kind: 'folder', path: raw }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.kind === 'search' && typeof o.query === 'string' && typeof o.scopePath === 'string') {
    return {
      kind: 'search',
      query: o.query,
      scopePath: o.scopePath,
      indexedOnly: o.indexedOnly === true
    }
  }
  if (o.kind === 'folder' && typeof o.path === 'string' && o.path.length > 0) {
    return { kind: 'folder', path: o.path }
  }
  if (typeof o.path === 'string' && o.path.length > 0) return { kind: 'folder', path: o.path }
  return null
}

export function coerceHistoryList(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const out: HistoryEntry[] = []
  for (const item of raw) {
    const e = coerceHistoryEntry(item)
    if (e) out.push(e)
  }
  return out
}
