/**
 * Execute StructuredQuery against SQLite index (and optional content scan).
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { SearchResultItem } from '@shared/schemas/search'
import { searchDb } from './db'
import {
  isBasicNameQuery,
  matchTextPred,
  parseEverythingQuery,
  rowMatchesStructured,
  type ParseOptions,
  type StructuredQuery
} from './everythingQuery'
import { compilePathPatterns } from '@shared/pathPatterns'
import { isHiddenSearchHit, normalizeSearchPathKey } from '@shared/searchHidden'
import { settingsStore } from '../settings/store'
import { nameMatches } from './queryBuilder'
import { buildSearchSql } from './searchSql'

type FileRow = {
  path: string
  name: string
  size: number
  mtime_ms: number
  is_dir: number
  attrs: number | null
  ext: string | null
}

const CONTENT_MAX_FILES = 80
const CONTENT_MAX_BYTES = 512 * 1024
const CONTENT_HARD_MS = 8000

function rowsToItems(rows: FileRow[], hiddenDirs?: ReadonlySet<string>): SearchResultItem[] {
  return rows.map((r) => ({
    path: r.path,
    name: r.name,
    size: Number(r.size),
    mtimeMs: Number(r.mtime_ms),
    isDir: Number(r.is_dir) === 1,
    isHidden: isHiddenSearchHit({ path: r.path, attrs: r.attrs, hiddenDirs })
  }))
}

function loadHiddenDirKeys(pathPrefix: string | null): Set<string> {
  const db = searchDb()
  let rows: { path: string }[]
  try {
    if (pathPrefix) {
      rows = db
        .prepare(
          `SELECT path FROM files WHERE is_dir = 1 AND attrs IS NOT NULL AND (attrs & 2) != 0 AND path LIKE ?`
        )
        .all(`${pathPrefix}%`) as { path: string }[]
    } else {
      rows = db
        .prepare(
          `SELECT path FROM files WHERE is_dir = 1 AND attrs IS NOT NULL AND (attrs & 2) != 0`
        )
        .all() as { path: string }[]
    }
  } catch {
    return new Set()
  }
  return new Set(rows.map((r) => normalizeSearchPathKey(r.path)))
}

async function filterContent(
  items: SearchResultItem[],
  needle: string,
  utf8Only: boolean
): Promise<SearchResultItem[]> {
  const start = Date.now()
  const out: SearchResultItem[] = []
  let checked = 0
  for (const item of items) {
    if (item.isDir) continue
    if (checked >= CONTENT_MAX_FILES || Date.now() - start > CONTENT_HARD_MS) break
    checked++
    try {
      const st = await fsp.stat(item.path)
      if (st.size > CONTENT_MAX_BYTES) continue
      const buf = await fsp.readFile(item.path)
      // Skip obvious binary
      const sample = buf.subarray(0, Math.min(buf.length, 4096))
      let nul = 0
      for (const b of sample) if (b === 0) nul++
      if (!utf8Only && nul > 8) continue
      const text =
        buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe
          ? buf.subarray(2).toString('utf16le')
          : buf.toString('utf8')
      if (text.toLowerCase().includes(needle.toLowerCase())) out.push(item)
    } catch {
      /* skip */
    }
  }
  return out
}

function applyDupes(items: SearchResultItem[], mode: 'name' | 'size' | 'namepart'): SearchResultItem[] {
  const groups = new Map<string, SearchResultItem[]>()
  for (const it of items) {
    let key: string
    if (mode === 'size') key = String(it.size)
    else if (mode === 'namepart') {
      const base = it.name.includes('.') ? it.name.slice(0, it.name.lastIndexOf('.')) : it.name
      key = base.toLowerCase()
    } else key = it.name.toLowerCase()
    const g = groups.get(key) ?? []
    g.push(it)
    groups.set(key, g)
  }
  const out: SearchResultItem[] = []
  for (const g of groups.values()) if (g.length > 1) out.push(...g)
  return out
}

export async function queryIndexStructured(
  query: string,
  pathPrefix: string | null,
  limit: number,
  parseOpts: ParseOptions
): Promise<{ items: SearchResultItem[]; partial: boolean; contentSlow?: boolean; structured: StructuredQuery }> {
  const basic = isBasicNameQuery(query)
  const q = parseEverythingQuery(
    query,
    basic ? { matchCase: parseOpts.matchCase, wholeWord: parseOpts.wholeWord } : parseOpts
  )
  const effectiveLimit = q.countLimit != null ? Math.min(limit, q.countLimit) : limit

  // Pull a wider candidate set when post-filters (text OR groups, regex, dupe, content) apply
  const pull = Math.min(
    20000,
    effectiveLimit * (q.dupe || q.content || q.regex || q.textGroups.some((g) => g.length > 1) ? 8 : 2)
  )

  const { sql, params } = buildSearchSql(q, pathPrefix)
  const db = searchDb()
  const rows = db.prepare(sql).all(...params, pull) as unknown as FileRow[]

  const settings = settingsStore().get()
  const excluded = compilePathPatterns(settings.searchExcludeDirNames)
  const showHidden = settings.searchShowHidden === true || q.attrib?.hidden === true
  const hiddenDirs = showHidden ? undefined : loadHiddenDirKeys(pathPrefix)
  const attrsByPath = new Map(rows.map((r) => [r.path, r.attrs]))
  let items = rowsToItems(rows, hiddenDirs).filter((it) => {
    if (excluded(it.path)) return false
    if (!showHidden && it.isHidden) return false
    return basic
      ? nameMatches(it.name, query)
      : rowMatchesStructured(
          {
            path: it.path,
            name: it.name,
            size: it.size,
            mtimeMs: it.mtimeMs,
            isDir: it.isDir,
            attrs: attrsByPath.get(it.path) ?? null
          },
          q,
          { rootPrefix: pathPrefix }
        )
  })

  // notText already in rowMatchesStructured

  if (q.childName) {
    // Keep dirs that have a child name in the index
    const child = q.childName.toLowerCase()
    const dirSet = new Set(
      items.filter((i) => i.isDir).map((i) => i.path.toLowerCase().replace(/\\+$/, ''))
    )
    const childParents = new Set<string>()
    for (const r of rows) {
      if (r.name.toLowerCase() === child || r.name.toLowerCase().includes(child)) {
        const parent = path.dirname(r.path).toLowerCase()
        childParents.add(parent)
      }
    }
    items = items.filter((i) => i.isDir && childParents.has(i.path.toLowerCase().replace(/\\+$/, '')))
    void dirSet
  }

  if (q.dupe) items = applyDupes(items, q.dupe)

  let contentSlow = false
  if (q.content) {
    contentSlow = true
    items = await filterContent(items, q.content, q.contentUtf8)
  }

  const partial = items.length > effectiveLimit
  return {
    items: items.slice(0, effectiveLimit),
    partial,
    contentSlow,
    structured: q
  }
}

export { parseEverythingQuery, matchTextPred }
