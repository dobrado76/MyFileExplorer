import fsp from 'node:fs/promises'
import path from 'node:path'
import type { SearchResultItem } from '@shared/schemas/search'
import { broadcast } from '../ipc/events'
import { nameMatches } from './queryBuilder'

export type CancelToken = { cancelled: boolean }

/**
 * Best-effort recursive walk (D15: progress + cancel, never pretend indexed
 * speed). Emits `search-progress` events while scanning.
 */
export async function liveWalkSearch(
  rootDir: string,
  query: string,
  excludeDirNames: string[],
  limit: number,
  token: CancelToken
): Promise<{ items: SearchResultItem[]; partial: boolean }> {
  const excludes = new Set(excludeDirNames.map((n) => n.toLowerCase()))
  const items: SearchResultItem[] = []
  const stack: string[] = [rootDir]
  let scanned = 0
  let partial = false

  while (stack.length > 0) {
    if (token.cancelled || items.length >= limit) {
      partial = true
      break
    }
    const dir = stack.pop()!
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const d of dirents) {
      if (token.cancelled || items.length >= limit) {
        partial = true
        break
      }
      const full = path.join(dir, d.name)
      const isDir = d.isDirectory()
      if (isDir && excludes.has(d.name.toLowerCase())) continue
      if (nameMatches(d.name, query)) {
        let size = 0
        let mtimeMs = 0
        try {
          const st = await fsp.stat(full)
          size = isDir ? 0 : st.size
          mtimeMs = st.mtimeMs
        } catch {
          // include with zeros
        }
        items.push({ path: full, name: d.name, size, mtimeMs, isDir })
      }
      if (isDir) stack.push(full)
      scanned++
      if (scanned % 500 === 0) {
        broadcast({
          type: 'search-progress',
          payload: { phase: 'walking', current: scanned, message: dir }
        })
        await new Promise((r) => setImmediate(r))
      }
    }
  }
  broadcast({ type: 'search-progress', payload: { phase: 'done', current: scanned } })
  return { items, partial }
}
