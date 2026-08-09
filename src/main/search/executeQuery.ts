/**
 * Execute StructuredQuery against SQLite index (and optional content scan).
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { SearchResultItem } from '@shared/schemas/search'
import { searchDb } from './db'
import {
  matchTextPred,
  parseEverythingQuery,
  rowMatchesStructured,
  type ParseOptions,
  type StructuredQuery
} from './everythingQuery'
import { buildPathPrefixLike, escapeLike } from './queryBuilder'

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

function rowsToItems(rows: FileRow[]): SearchResultItem[] {
  return rows.map((r) => ({
    path: r.path,
    name: r.name,
    size: Number(r.size),
    mtimeMs: Number(r.mtime_ms),
    isDir: Number(r.is_dir) === 1
  }))
}

function buildSql(q: StructuredQuery, pathPrefix: string | null): {
  sql: string
  params: (string | number)[]
} {
  const clauses: string[] = ['1=1']
  const params: (string | number)[] = []

  if (pathPrefix) {
    clauses.push(`path LIKE ? ESCAPE '\\'`)
    params.push(buildPathPrefixLike(pathPrefix))
  }
  for (const p of q.pathPrefixes) {
    clauses.push(`path LIKE ? ESCAPE '\\'`)
    params.push(escapeLike(p) + '%')
  }
  for (const c of q.pathContains) {
    clauses.push(`path LIKE ? ESCAPE '\\'`)
    params.push('%' + escapeLike(c) + '%')
  }
  for (const c of q.excludePathContains) {
    clauses.push(`path NOT LIKE ? ESCAPE '\\'`)
    params.push('%' + escapeLike(c) + '%')
  }
  if (q.fileOnly) clauses.push('is_dir = 0')
  if (q.folderOnly) clauses.push('is_dir = 1')
  if (q.exts.length) {
    clauses.push(`lower(ext) IN (${q.exts.map(() => '?').join(',')})`)
    params.push(...q.exts.map((e) => e.toLowerCase()))
  }
  if (q.size) {
    if (q.size.op === 'range') {
      clauses.push('size >= ? AND size <= ?')
      params.push(q.size.min, q.size.max)
    } else {
      const op =
        q.size.op === 'eq'
          ? '='
          : q.size.op === 'gt'
            ? '>'
            : q.size.op === 'lt'
              ? '<'
              : q.size.op === 'ge'
                ? '>='
                : '<='
      clauses.push(`size ${op} ?`)
      params.push(q.size.bytes)
    }
  }
  if (q.empty === true) clauses.push('size = 0')
  if (q.empty === false) clauses.push('size > 0')
  if (q.lenMin != null) {
    clauses.push('length(name) >= ?')
    params.push(q.lenMin)
  }
  if (q.lenMax != null) {
    clauses.push('length(name) <= ?')
    params.push(q.lenMax)
  }
  for (const d of q.dates) {
    if (d.op === 'range') {
      clauses.push('mtime_ms >= ? AND mtime_ms <= ?')
      params.push(d.min, d.max)
    } else {
      const op =
        d.op === 'eq' ? '=' : d.op === 'gt' ? '>' : d.op === 'lt' ? '<' : d.op === 'ge' ? '>=' : '<='
      clauses.push(`mtime_ms ${op} ?`)
      params.push(d.ms)
    }
  }
  if (q.parentName) {
    clauses.push(`path LIKE ? ESCAPE '\\'`)
    params.push('%\\' + escapeLike(q.parentName) + '\\%')
  }
  if (q.infolder) {
    clauses.push(`(path LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\')`)
    params.push(
      '%\\' + escapeLike(q.infolder) + '\\%',
      '%\\' + escapeLike(q.infolder)
    )
  }

  // Cheap text AND of first OR-group members via LIKE when simple substr/glob
  for (const group of q.textGroups) {
    if (group.length === 1) {
      const pred = group[0]!
      if (pred.kind === 'substr' && !pred.wholeWord && !q.regex) {
        const col = q.matchPath ? `(name LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\')` : `name LIKE ? ESCAPE '\\'`
        clauses.push(col)
        const pat = '%' + escapeLike(pred.value) + '%'
        params.push(pat)
        if (q.matchPath) params.push(pat)
      } else if (pred.kind === 'glob') {
        const like = pred.value.replace(/\*/g, '%').replace(/\?/g, '_')
        clauses.push(q.matchPath ? `(name LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\')` : `name LIKE ? ESCAPE '\\'`)
        params.push(like)
        if (q.matchPath) params.push(like)
      }
    }
  }

  const sql = `
    SELECT path, name, size, mtime_ms, is_dir, attrs, ext
    FROM files
    WHERE ${clauses.join(' AND ')}
    ORDER BY name
    LIMIT ?`
  return { sql, params }
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
  const q = parseEverythingQuery(query, parseOpts)
  const effectiveLimit = q.countLimit != null ? Math.min(limit, q.countLimit) : limit

  // Pull a wider candidate set when post-filters (text OR groups, regex, dupe, content) apply
  const pull = Math.min(
    20000,
    effectiveLimit * (q.dupe || q.content || q.regex || q.textGroups.some((g) => g.length > 1) ? 8 : 2)
  )

  const { sql, params } = buildSql(q, pathPrefix)
  const db = searchDb()
  const rows = db.prepare(sql).all(...params, pull) as unknown as FileRow[]

  let items = rowsToItems(rows).filter((it) =>
    rowMatchesStructured(
      {
        path: it.path,
        name: it.name,
        size: it.size,
        mtimeMs: it.mtimeMs,
        isDir: it.isDir,
        attrs: rows.find((r) => r.path === it.path)?.attrs ?? null
      },
      q,
      { rootPrefix: pathPrefix }
    )
  )

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
