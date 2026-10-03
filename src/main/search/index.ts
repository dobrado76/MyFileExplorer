import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import type {
  SearchQueryRequest,
  SearchQueryResponse,
  SearchResultItem
} from '@shared/schemas/search'
import { compilePathPatterns } from '@shared/pathPatterns'
import { isHiddenSearchHit } from '@shared/searchHidden'
import { allUserMetadataFields } from '@shared/schemas/userMetadata'
import { VID_THUMB_CACHE_DIR } from '@shared/vidThumbCache'
import { normalizeAbsolute, isSameOrUnder } from '../security/paths'
import { broadcast } from '../ipc/events'
import { settingsStore } from '../settings/store'
import { pathIsHidden } from '../fs/winAttrs'
import { searchDb } from './db'
import { isIncompleteSearchQuery, nameMatches, queryTokens } from './queryBuilder'
import { mergeLiveSearchHits } from '@shared/searchQuery'
import { isBasicNameQuery, parseEverythingQuery, rowMatchesStructured, searchDecodeMessage } from './everythingQuery'
import { liveWalkSearch, type CancelToken } from './liveWalk'
import { queryIndexStructured } from './executeQuery'
import { isSkippedBySearchExclude } from './searchExclude'
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
    customMacros,
    userMetadataFields:
      s.userMetadata?.enabled === true
        ? allUserMetadataFields(s.userMetadata ?? { enabled: false, sets: [], bindings: [] })
        : []
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

/** One-directory listing match — disk is the source of truth for the folder you are in. */
async function searchImmediateChildren(
  dir: string,
  query: string,
  limit: number,
  req: SearchQueryRequest
): Promise<SearchResultItem[]> {
  const items: SearchResultItem[] = []
  let dirents
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return items
  }
  const opts = parseOptsFromReq(req)
  const basic = isBasicNameQuery(query)
  const q = basic ? null : parseEverythingQuery(query, opts)
  const settings = settingsStore().get()
  const excluded = compilePathPatterns(settings.searchExcludeDirNames)
  const showHidden = settings.searchShowHidden === true || q?.attrib?.hidden === true
  for (const d of dirents) {
    const full = path.join(dir, d.name)
    if (isSkippedBySearchExclude(full, excluded, query, basic ? null : q, basic)) continue
    const isDir = d.isDirectory()
    const hidden =
      d.name.toLowerCase() === VID_THUMB_CACHE_DIR.toLowerCase() ||
      pathIsHidden(full) ||
      isHiddenSearchHit({ path: full })
    if (!showHidden && hidden) continue
    let size = 0
    let mtimeMs = 0
    let birthtimeMs = 0
    let atimeMs = 0
    try {
      const st = await fsp.stat(full)
      size = isDir ? 0 : st.size
      mtimeMs = st.mtimeMs
      birthtimeMs = st.birthtimeMs
      atimeMs = st.atimeMs
    } catch {
      /* zeros — still list the name; missing from index must not hide a dirent */
    }
    const hit = basic
      ? nameMatches(d.name, query)
      : rowMatchesStructured(
          { path: full, name: d.name, size, mtimeMs, birthtimeMs, atimeMs, isDir },
          q!,
          { rootPrefix: dir }
        )
    if (hit) {
      items.push({ path: full, name: d.name, size, mtimeMs, isDir, isHidden: hidden })
    }
    if (items.length >= limit) break
  }
  return items
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
    const items = await searchImmediateChildren(dir, query, limit, req)
    return { items, partial: items.length >= limit, source: 'walk' }
  }

  if (scope.useIndexIfCovered) {
    const covered = readyRootCovering(dir)
    if (covered && covered.fileCount > 0) {
      broadcast({
        type: 'search-progress',
        payload: { phase: 'querying', message: dir, gen: req.gen }
      })
      const indexed = await queryIndexStructured(query, dir, limit, opts)
      // Always overlay the current folder from disk. A stale index that still
      // has *some* hits (e.g. .srt / .nfo) would otherwise never fall through
      // to a live walk — hiding a sibling .mp4 that exists on disk.
      const live = await searchImmediateChildren(dir, query, limit, req)
      const items = mergeLiveSearchHits(indexed.items, live, limit)
      const wantsName = isBasicNameQuery(query) || decoded.textGroups.length > 0
      if (items.length > 0 || !wantsName) {
        broadcast({
          type: 'search-progress',
          payload: { phase: 'done', current: items.length, items: [...items], gen: req.gen }
        })
        return {
          items: items.slice(offset, offset + limit),
          partial: indexed.partial || items.length >= limit,
          source: 'index',
          contentSlow: indexed.contentSlow
        }
      }
    }
  }

  return runLiveWalk(dir, query, limit, req)
}

/** Touch DB so migrations run. */
export function ensureSearchDb(): void {
  searchDb()
}
