import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import type {
  SearchQueryRequest,
  SearchQueryResponse,
  SearchResultItem
} from '@shared/schemas/search'
import { compilePathPatterns } from '@shared/pathPatterns'
import { normalizeAbsolute, isSameOrUnder } from '../security/paths'
import { broadcast } from '../ipc/events'
import { settingsStore } from '../settings/store'
import { searchDb } from './db'
import { isIncompleteSearchQuery, nameMatches, queryTokens } from './queryBuilder'
import { isBasicNameQuery, parseEverythingQuery, searchDecodeMessage } from './everythingQuery'
import { liveWalkSearch, type CancelToken } from './liveWalk'
import { queryIndexStructured } from './executeQuery'
import {
  listIndexRoots,
  addIndexRoot,
  addVolumeRoot,
  removeIndexRoot,
  scheduleIndex,
  cancelIndexing,
  initSearchIndexRuntime,
  shutdownSearchIndexRuntime
} from './indexer'

export {
  listIndexRoots,
  addIndexRoot,
  addVolumeRoot,
  removeIndexRoot,
  scheduleIndex,
  initSearchIndexRuntime,
  shutdownSearchIndexRuntime
}

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

function parseOptsFromReq(req: SearchQueryRequest) {
  const s = settingsStore().get()
  const customMacros: Record<string, string[]> = {}
  for (const f of s.searchFilters ?? []) {
    if (f.macro && f.query.startsWith('ext:')) {
      const exts = f.query
        .slice(4)
        .split(/[;,]/)
        .map((x) => x.replace(/^\./, '').trim().toLowerCase())
        .filter(Boolean)
      if (exts.length) customMacros[f.macro.toLowerCase()] = exts
    }
  }
  const basic = isBasicNameQuery(req.query)
  return {
    matchPath: basic ? false : (req.matchPath ?? s.searchMatchPath),
    matchCase: req.matchCase ?? s.searchMatchCase,
    wholeWord: req.wholeWord ?? s.searchWholeWord,
    regex: basic ? false : (req.regex ?? s.searchRegex),
    customMacros
  }
}

function readyRootCovering(dirPath: string): { path: string; fileCount: number } | null {
  for (const root of listIndexRoots()) {
    if ((root.status === 'ready' || root.status === 'offline') && isSameOrUnder(dirPath, root.path)) {
      if (root.status === 'ready') return { path: root.path, fileCount: root.fileCount }
    }
  }
  return null
}

async function runLiveWalk(
  dir: string,
  query: string,
  limit: number,
  req: SearchQueryRequest
): Promise<SearchQueryResponse> {
  if (activeWalk) activeWalk.cancelled = true
  const token: CancelToken = { cancelled: false }
  activeWalk = token
  try {
    const settings = settingsStore().get()
    const { items, partial, contentSlow } = await liveWalkSearch(
      dir,
      query,
      settings.searchExcludeDirNames,
      limit,
      token,
      parseOptsFromReq(req),
      req.gen ?? 0,
      settings.searchShowHidden === true
    )
    return { items, partial, source: 'walk', contentSlow }
  } finally {
    if (activeWalk === token) activeWalk = null
  }
}

export async function runSearchQuery(req: SearchQueryRequest): Promise<SearchQueryResponse> {
  const { query, scope, limit, offset } = req
  // Allow operator-only queries like `size:>1mb` / `pic:` with no bare tokens
  const hasTokens = queryTokens(query).length > 0 || /[a-z]+:/i.test(query)
  if (!hasTokens || isIncompleteSearchQuery(query)) {
    return { items: [], partial: false, source: 'walk' }
  }

  const opts = parseOptsFromReq(req)
  const decoded = parseEverythingQuery(query, opts)
  const decodeMsg = searchDecodeMessage(query, decoded)
  if (decodeMsg) {
    return { items: [], partial: false, source: 'walk', message: decodeMsg }
  }

  if (scope.type === 'indexed') {
    const ready = listIndexRoots().filter((r) => r.status === 'ready')
    if (ready.length === 0) {
      throw new AppError(
        'validation',
        'No indexed folders are ready.',
        'Uncheck “indexed” to search the current folder (works without an index), or add a folder/drive under Settings → Search.'
      )
    }
    broadcast({
      type: 'search-progress',
      payload: { phase: 'querying', message: 'All indexed locations', gen: req.gen }
    })
    const { items, partial, contentSlow } = await queryIndexStructured(
      query,
      null,
      limit,
      opts
    )
    broadcast({
      type: 'search-progress',
      payload: { phase: 'done', current: items.length, items: [...items], gen: req.gen }
    })
    return {
      items: items.slice(offset, offset + limit),
      partial,
      source: 'index',
      contentSlow
    }
  }

  const dir = normalizeAbsolute(scope.path)
  if (!dir) throw new AppError('validation', `Not an absolute path: ${scope.path}`)

  if (!scope.recursive) {
    const items: SearchResultItem[] = []
    const dirents = await fsp.readdir(dir, { withFileTypes: true })
    const basic = isBasicNameQuery(query)
    const { parseEverythingQuery, rowMatchesStructured } = await import('./everythingQuery')
    const q = basic ? null : parseEverythingQuery(query, opts)
    const excluded = compilePathPatterns(settingsStore().get().searchExcludeDirNames)
    for (const d of dirents) {
      const full = path.join(dir, d.name)
      if (excluded(full)) continue
      const isDir = d.isDirectory()
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
            { path: full, name: d.name, size, mtimeMs, isDir },
            q!,
            { rootPrefix: dir, childCount: isDir ? undefined : undefined }
          )
      if (hit) {
        items.push({ path: full, name: d.name, size, mtimeMs, isDir })
      }
      if (items.length >= limit) break
    }
    return { items, partial: items.length >= limit, source: 'walk' }
  }

  if (scope.useIndexIfCovered) {
    const covered = readyRootCovering(dir)
    if (covered && covered.fileCount > 0) {
      broadcast({
        type: 'search-progress',
        payload: { phase: 'querying', message: dir, gen: req.gen }
      })
      const { items, partial, contentSlow } = await queryIndexStructured(
        query,
        dir,
        limit,
        opts
      )
      broadcast({
        type: 'search-progress',
        payload: { phase: 'done', current: items.length, items: [...items], gen: req.gen }
      })
      return {
        items: items.slice(offset, offset + limit),
        partial,
        source: 'index',
        contentSlow
      }
    }
  }

  return runLiveWalk(dir, query, limit, req)
}

/** Touch DB so migrations run. */
export function ensureSearchDb(): void {
  searchDb()
}
