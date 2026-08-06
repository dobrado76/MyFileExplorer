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
import { searchDb } from './db'
import { buildNameLikeParams, buildPathPrefixLike, nameMatches, queryTokens } from './queryBuilder'
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

/**
 * Substring name search against the SQLite index (same semantics as live walk).
 * Uses LIKE per token — not FTS prefix — so “photo” finds MyPhoto.jpg.
 */
function queryIndex(
  query: string,
  pathPrefix: string | null,
  limit: number,
  offset: number
): SearchResultItem[] {
  const nameParams = buildNameLikeParams(query)
  if (nameParams.length === 0) return []

  const db = searchDb()
  const nameClauses = nameParams.map(() => `name LIKE ? ESCAPE '\\'`).join(' AND ')
  const sql = `
    SELECT path, name, size, mtime_ms, is_dir
    FROM files
    WHERE ${nameClauses}
    ${pathPrefix ? "AND path LIKE ? ESCAPE '\\'" : ''}
    ORDER BY name
    LIMIT ? OFFSET ?`
  const params: (string | number)[] = [...nameParams]
  if (pathPrefix) params.push(buildPathPrefixLike(pathPrefix))
  params.push(limit, offset)
  return rowsToItems(db.prepare(sql).all(...params) as unknown as FileRow[])
}

function readyRootCovering(dirPath: string): { path: string; fileCount: number } | null {
  for (const root of listIndexRoots()) {
    if (root.status === 'ready' && isSameOrUnder(dirPath, root.path)) {
      return { path: root.path, fileCount: root.fileCount }
    }
  }
  return null
}

async function runLiveWalk(
  dir: string,
  query: string,
  limit: number
): Promise<SearchQueryResponse> {
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

export async function runSearchQuery(req: SearchQueryRequest): Promise<SearchQueryResponse> {
  const { query, scope, limit, offset } = req
  if (queryTokens(query).length === 0) {
    return { items: [], partial: false, source: 'walk' }
  }

  if (scope.type === 'indexed') {
    const ready = listIndexRoots().filter((r) => r.status === 'ready')
    if (ready.length === 0) {
      throw new AppError(
        'validation',
        'No indexed folders are ready.',
        'Uncheck “indexed” to search the current folder (works without an index), or add a folder under Settings → Search index.'
      )
    }
    // Global indexed search — still substring LIKE, not FTS-only.
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

  // Index is an accelerator only — empty/missing coverage must still live-walk (D15).
  if (scope.useIndexIfCovered) {
    const covered = readyRootCovering(dir)
    if (covered && covered.fileCount > 0) {
      return {
        items: queryIndex(query, dir, limit, offset),
        partial: false,
        source: 'index'
      }
    }
  }

  return runLiveWalk(dir, query, limit)
}
