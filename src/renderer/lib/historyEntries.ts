import { samePath } from './paths'

/**
 * Recent Locations: same order as repeated Back from here.
 * Top = current, then most recent previous, …, oldest. Forward stack follows
 * (only present after Back; not part of the Back chain). Deduped, first wins.
 */
export function historyEntries(
  back: string[],
  current: string,
  forward: string[] = []
): { path: string; current: boolean }[] {
  // tab.back is oldest→newest; reverse so newest previous is right under current.
  const ordered = [
    ...(current ? [current] : []),
    ...[...back].reverse(),
    ...forward
  ]
  const seen = new Set<string>()
  const out: { path: string; current: boolean }[] = []
  for (const p of ordered) {
    if (!p) continue
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ path: p, current: current ? samePath(p, current) : false })
  }
  return out
}
