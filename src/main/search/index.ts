import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import type {
  SearchQueryRequest,
  SearchQueryResponse,
  SearchResultItem
} from '@shared/schemas/search'
import { normalizeAbsolute, isSameOrUnder } from '../security/paths'
import { settingsStore } from '../settings/store'
import { searchDb, isFtsAvailable } from './db'
import {
  buildFtsMatchExpression,
  buildLikeContains,
  buildPathPrefixLike,
  nameMatches
} from './queryBuilder'
import { liveWalkSearch, type CancelToken } from './liveWalk'
import {
  listIndexRoots,
  addIndexRoot,
  removeIndexRoot,
  scheduleIndex,
  cancelIndexing
} from './indexer'

export { listIndexRoots, addIndexRoot, removeIndexRoot, scheduleIndex }

type FileRow = { path: string; name: string; size: number; mtime_ms: number; is_dir: number }

let activeWalk: CancelToken | null = null

export function cancelSearch(): { cancelled: boolean } {
  let cancelled = false
  if (activeWalk) {
    activeWalk.cancelled = true
    cancelled = true
  }
  if (cancelIndexing()) cancelled = true
  return { cancelled }
}

function rowsToItems(rows: FileRow[]): SearchResultItem[] {
  return rows.map((r) => ({
    path: r.path,
    name: r.name,
    size: Number(r.size),
    mtimeMs: Number(r.mtime_ms),
    isDir: Number(r.is_dir) === 1
  }))
}

function queryIndex(
  query: string,
  pathPrefix: string | null,
  limit: number,
  offset: number
): SearchResultItem[] {
  const db = searchDb()
  if (isFtsAvailable()) {
    const match = buildFtsMatchExpression(query)
    if (!match) return []
    const sql = `
      SELECT f.path, f.name, f.size, f.mtime_ms, f.is_dir
      FROM files_fts
      JOIN files f ON f.id = files_fts.rowid
      WHERE files_fts MATCH ?
      ${pathPrefix ? "AND f.path LIKE ? ESCAPE '\\'" : ''}
      ORDER BY rank
      LIMIT ? OFFSET ?`
    const params = pathPrefix
      ? [match, buildPathPrefixLike(pathPrefix), limit, offset]
      : [match, limit, offset]
    return rowsToItems(db.prepare(sql).all(...params) as unknown as FileRow[])
  }
  const sql = `
    SELECT path, name, size, mtime_ms, is_dir
    FROM files
    WHERE name LIKE ? ESCAPE '\\'
    ${pathPrefix ? "AND path LIKE ? ESCAPE '\\'" : ''}
    ORDER BY name
    LIMIT ? OFFSET ?`
  const params = pathPrefix
    ? [buildLikeContains(query), buildPathPrefixLike(pathPrefix), limit, offset]
    : [buildLikeContains(query), limit, offset]
  return rowsToItems(db.prepare(sql).all(...params) as unknown as FileRow[])
}

function readyRootCovering(dirPath: string): string | null {
  for (const root of listIndexRoots()) {
    if (root.status === 'ready' && isSameOrUnder(dirPath, root.path)) return root.path
  }
  return null
}

export async function runSearchQuery(req: SearchQueryRequest): Promise<SearchQueryResponse> {
  const { query, scope, limit, offset } = req

  if (scope.type === 'indexed') {
    return { items: queryIndex(query, null, limit, offset), partial: false, source: 'index' }
  }

  const dir = normalizeAbsolute(scope.path)
  if (!dir) throw new AppError('validation', `Not an absolute path: ${scope.path}`)

  if (!scope.recursive) {
    // Shallow: a single readdir is always fast enough.
    const items: SearchResultItem[] = []
    const dirents = await fsp.readdir(dir, { withFileTypes: true })
    for (const d of dirents) {
      if (!nameMatches(d.name, query)) continue
      const full = path.join(dir, d.name)
      const isDir = d.isDirectory()
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
      if (items.length >= limit) break
    }
    return { items, partial: items.length >= limit, source: 'walk' }
  }

  if (scope.useIndexIfCovered && readyRootCovering(dir)) {
    return { items: queryIndex(query, dir, limit, offset), partial: false, source: 'index' }
  }

  // Live walk fallback (D15)
  if (activeWalk) activeWalk.cancelled = true
  const token: CancelToken = { cancelled: false }
  activeWalk = token
  try {
    const excludes = settingsStore().get().searchExcludeDirNames
    const { items, partial } = await liveWalkSearch(dir, query, excludes, limit, token)
    return { items, partial, source: 'walk' }
  } finally {
    if (activeWalk === token) activeWalk = null
  }
}
