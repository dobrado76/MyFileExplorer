import {
  historyEntryKey,
  historyEntryLabel,
  historyLocationPath,
  sameHistoryEntry,
  type HistoryEntry
} from '@shared/tabHistory'

export type RecentLocation = {
  key: string
  path: string
  label: string
  entry: HistoryEntry
  current: boolean
}

/**
 * Recent Locations: same order as repeated Back from here.
 * Top = current, then most recent previous, …, oldest. Forward stack follows
 * (only present after Back; not part of the Back chain). Deduped, first wins.
 */
export function historyEntries(
  back: HistoryEntry[],
  current: HistoryEntry,
  forward: HistoryEntry[] = []
): RecentLocation[] {
  const ordered = [current, ...[...back].reverse(), ...forward]
  const seen = new Set<string>()
  const out: RecentLocation[] = []
  for (const entry of ordered) {
    const key = historyEntryKey(entry)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      key,
      path: historyLocationPath(entry),
      label: historyEntryLabel(entry),
      entry,
      current: sameHistoryEntry(entry, current)
    })
  }
  return out
}
