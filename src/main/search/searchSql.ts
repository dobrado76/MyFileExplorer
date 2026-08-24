/**
 * Pure SQL builder for StructuredQuery — no Electron / SQLite deps (testable).
 */
import type { StructuredQuery } from './everythingQuery'
import { buildPathPrefixLike, escapeLike } from './queryBuilder'

export function buildSearchSql(
  q: StructuredQuery,
  pathPrefix: string | null
): {
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
  if (q.excludeExts.length) {
    clauses.push(`(is_dir = 1 OR lower(ext) NOT IN (${q.excludeExts.map(() => '?').join(',')}))`)
    params.push(...q.excludeExts.map((e) => e.toLowerCase()))
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
    params.push('%\\' + escapeLike(q.infolder) + '\\%', '%\\' + escapeLike(q.infolder))
  }

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

/** Note-only queries: catalog in userData (updated when a note is saved). Verify with ADS after. */
export function buildNoteIndexSql(
  q: StructuredQuery,
  pathPrefix: string | null
): {
  sql: string
  params: (string | number)[]
} {
  const clauses: string[] = ['1=1']
  const params: (string | number)[] = []

  if (pathPrefix) {
    clauses.push(`f.path LIKE ? ESCAPE '\\'`)
    params.push(buildPathPrefixLike(pathPrefix))
  }
  for (const p of q.pathPrefixes) {
    clauses.push(`f.path LIKE ? ESCAPE '\\'`)
    params.push(escapeLike(p) + '%')
  }
  if (q.fileOnly) clauses.push('f.is_dir = 0')
  if (q.folderOnly) clauses.push('f.is_dir = 1')
  if (q.noteText) {
    clauses.push(`n.haystack LIKE ? ESCAPE '\\'`)
    params.push('%' + escapeLike(q.noteText.toLowerCase()) + '%')
  }
  if (q.noteStatus) {
    clauses.push(`lower(n.status) LIKE ? ESCAPE '\\'`)
    params.push('%' + escapeLike(q.noteStatus.toLowerCase()) + '%')
  }
  if (q.openTodo) clauses.push('n.open_todo = 1')

  const sql = `
    SELECT f.path, f.name, f.size, f.mtime_ms, f.is_dir, f.attrs, f.ext
    FROM files f
    INNER JOIN item_notes n ON n.path = f.path
    WHERE ${clauses.join(' AND ')}
    ORDER BY f.name
    LIMIT ?`
  return { sql, params }
}
