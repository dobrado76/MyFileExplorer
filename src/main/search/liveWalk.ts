import fsp from 'node:fs/promises'
import path from 'node:path'
import type { SearchResultItem } from '@shared/schemas/search'
import { broadcast } from '../ipc/events'
import {
  isBasicNameQuery,
  parseEverythingQuery,
  rowMatchesStructured,
  type ParseOptions,
  type StructuredQuery
} from './everythingQuery'
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
  token: CancelToken,
  parseOpts: ParseOptions = {},
  gen = 0
): Promise<{ items: SearchResultItem[]; partial: boolean; contentSlow?: boolean }> {
  const basic = isBasicNameQuery(query)
  const q = basic ? null : parseEverythingQuery(query, parseOpts)
  const excludes = new Set(excludeDirNames.map((n) => n.toLowerCase()))
  const items: SearchResultItem[] = []
  const stack: string[] = [rootDir]
  let scanned = 0
  let partial = false
  const effectiveLimit = q?.countLimit != null ? Math.min(limit, q.countLimit) : limit

  let lastEmitMs = 0
  let lastEmitHits = 0
  const emitProgress = (dir: string, force = false): void => {
    const now = Date.now()
    const newHits = items.length > lastEmitHits
    if (!force && scanned % 100 !== 0 && !newHits && now - lastEmitMs < 250) return
    lastEmitMs = now
    lastEmitHits = items.length
    broadcast({
      type: 'search-progress',
      payload: {
        phase: 'walking',
        current: scanned,
        message: dir,
        items: items.length ? [...items] : undefined,
        gen
      }
    })
  }

  emitProgress(rootDir, true)

  while (stack.length > 0) {
    if (token.cancelled || items.length >= effectiveLimit) {
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
      if (token.cancelled || items.length >= effectiveLimit) {
        partial = true
        break
      }
      const full = path.join(dir, d.name)
      const isDir = d.isDirectory()
      if (isDir && excludes.has(d.name.toLowerCase())) continue

      let size = 0
      let mtimeMs = 0
      try {
        const st = await fsp.stat(full)
        size = isDir ? 0 : st.size
        mtimeMs = st.mtimeMs
      } catch {
        /* zeros */
      }

      const hit = basic
        ? nameMatches(d.name, query)
        : rowMatchesStructured(
            { path: full, name: d.name, size, mtimeMs, isDir, attrs: null },
            q!,
            { rootPrefix: rootDir, childCount: isDir ? dirents.length : undefined }
          )

      if (hit) {
        items.push({ path: full, name: d.name, size, mtimeMs, isDir })
      }
      if (isDir) stack.push(full)
      scanned++
      emitProgress(dir)
      if (scanned % 500 === 0) await new Promise((r) => setImmediate(r))
    }
  }
  broadcast({
    type: 'search-progress',
    payload: { phase: 'done', current: scanned, message: rootDir, items: [...items], gen }
  })

  let contentSlow = false
  if (q?.content && items.length) {
    contentSlow = true
    // Light content filter in walk path
    const { queryIndexStructured } = await import('./executeQuery')
    void queryIndexStructured
    const needle = q.content.toLowerCase()
    const kept: SearchResultItem[] = []
    for (const it of items) {
      if (it.isDir) continue
      try {
        const buf = await fsp.readFile(it.path)
        if (buf.length > 512 * 1024) continue
        const text = buf.toString('utf8')
        if (text.toLowerCase().includes(needle)) kept.push(it)
      } catch {
        /* skip */
      }
      if (kept.length >= effectiveLimit) break
    }
    return { items: kept, partial, contentSlow }
  }

  return { items, partial, contentSlow }
}

export type { StructuredQuery }
