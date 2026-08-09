/** Shared upsert/delete helpers for indexer + watch + USN. */
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { searchDb } from './db'

export type FileUpsert = {
  path: string
  name: string
  ext: string
  size: number
  mtimeMs: number
  isDir: boolean
  attrs?: number | null
}

export function upsertFileRows(rootId: number, rows: FileUpsert[]): void {
  if (rows.length === 0) return
  const db = searchDb()
  const insert = db.prepare(
    `INSERT INTO files (root_id, path, name, ext, size, mtime_ms, is_dir, attrs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       root_id = excluded.root_id, name = excluded.name, ext = excluded.ext,
       size = excluded.size, mtime_ms = excluded.mtime_ms, is_dir = excluded.is_dir,
       attrs = COALESCE(excluded.attrs, files.attrs)`
  )
  db.exec('BEGIN')
  try {
    for (const r of rows) {
      insert.run(
        rootId,
        r.path,
        r.name,
        r.ext,
        r.size,
        r.mtimeMs,
        r.isDir ? 1 : 0,
        r.attrs ?? null
      )
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function deleteFilePaths(paths: string[]): void {
  if (paths.length === 0) return
  const db = searchDb()
  const del = db.prepare('DELETE FROM files WHERE path = ?')
  db.exec('BEGIN')
  try {
    for (const p of paths) del.run(p)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/** Delete a path and all indexed descendants (folder rename/delete). */
export function deletePathTree(filePath: string): void {
  const db = searchDb()
  const withSep =
    filePath.endsWith('\\') || filePath.endsWith('/') ? filePath : filePath + '\\'
  const escaped =
    withSep.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_') + '%'
  db.prepare(`DELETE FROM files WHERE path = ? OR path LIKE ? ESCAPE '\\'`).run(
    filePath,
    escaped
  )
}

export function fileRowFromPath(
  full: string,
  isDir: boolean,
  size: number,
  mtimeMs: number,
  attrs?: number | null
): FileUpsert {
  const name = path.basename(full)
  return {
    path: full,
    name,
    ext: isDir ? '' : path.extname(name).slice(1).toLowerCase(),
    size: isDir ? 0 : size,
    mtimeMs,
    isDir,
    attrs
  }
}

export function getRootIdByPath(rootPath: string): number | null {
  const db = searchDb()
  const row = db.prepare('SELECT id FROM roots WHERE path = ?').get(rootPath) as
    | { id: number }
    | undefined
  return row?.id ?? null
}

export function db(): DatabaseSync {
  return searchDb()
}
