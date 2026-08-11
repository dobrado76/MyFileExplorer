import type { DirEntry } from '@shared/schemas/fs'
import { pathKey } from '@shared/paths'

/**
 * Drop duplicate paths (case-insensitive on Windows). Listing / search / recycle
 * can occasionally emit the same path twice; React keys and selection break if
 * we keep both.
 */
export function dedupeDirEntries(entries: DirEntry[]): DirEntry[] {
  if (entries.length < 2) return entries
  const seen = new Set<string>()
  const out: DirEntry[] = []
  for (const e of entries) {
    const k = pathKey(e.path)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out.length === entries.length ? entries : out
}
