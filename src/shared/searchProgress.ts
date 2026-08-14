import type { SearchResultItem } from './schemas/search'

/** Progress payload for search-progress events (kept here to avoid circular imports). */
export type SearchProgressPayload = {
  phase: 'walking' | 'querying' | 'done'
  current?: number
  total?: number
  message?: string
  items?: SearchResultItem[]
  /** Matches the in-flight search generation; ignore events from a cancelled query. */
  gen?: number
}

/** Human-readable search progress for status bar, banner, and empty state. */
export function formatSearchProgress(p: SearchProgressPayload): string {
  const scanned =
    p.current != null && p.current > 0 ? `${p.current.toLocaleString()} scanned` : null
  const folder = p.message?.trim()

  if (p.phase === 'querying') {
    return folder ? `Querying index — ${folder}` : 'Querying index…'
  }
  if (p.phase === 'walking') {
    if (scanned && folder) return `${scanned} · ${folder}`
    if (folder) return folder
    if (scanned) return `${scanned}…`
    return 'Scanning folders…'
  }
  return ''
}
