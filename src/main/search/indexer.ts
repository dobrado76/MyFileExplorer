import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import type { IndexRootInfo, IndexRootStatus } from '@shared/schemas/search'
import { normalizeAbsolute, isSameOrUnder, pathKey } from '../security/paths'
import { settingsStore } from '../settings/store'
import { broadcast } from '../ipc/events'
import { logMain } from '../logging'
import { searchDb } from './db'

type RootRow = {
  id: number
  path: string
  added_at: string
  last_indexed_at: string | null
  status: string
}

let indexing = false
let cancelRequested = false
const queue: string[] = []

export function listIndexRoots(): IndexRootInfo[] {
  const db = searchDb()
  const rows = db.prepare('SELECT * FROM roots ORDER BY path').all() as unknown as RootRow[]
  const countStmt = db.prepare('SELECT COUNT(*) AS c FROM files WHERE root_id = ?')
  return rows.map((r) => ({
    path: r.path,
    status: r.status as IndexRootStatus,
    addedAt: r.added_at,
    lastIndexedAt: r.last_indexed_at,
    fileCount: Number((countStmt.get(r.id) as { c: number } | undefined)?.c ?? 0)
  }))
}

export function addIndexRoot(rawPath: string): IndexRootInfo[] {
  const root = normalizeAbsolute(rawPath)
  if (!root) throw new AppError('validation', `Not an absolute path: ${rawPath}`)
  const db = searchDb()
  const rows = db.prepare('SELECT * FROM roots').all() as unknown as RootRow[]

  // Parent-covers-child: adding under an existing root is redundant.
  const covering = rows.find((r) => isSameOrUnder(root, r.path))
  if (covering) {
    throw new AppError(
      'conflict',
      `Already covered by indexed root "${covering.path}"`,
      'Remove the parent root first if you want to index this folder separately.'
    )
  }
  // Adding a parent absorbs existing children.
  for (const r of rows) {
    if (isSameOrUnder(r.path, root) && pathKey(r.path) !== pathKey(root)) {
      db.prepare('DELETE FROM roots WHERE id = ?').run(r.id)
      logMain('info', `Index root "${r.path}" absorbed by new parent "${root}"`)
    }
  }

  db.prepare('INSERT INTO roots (path, added_at, status) VALUES (?, ?, ?)').run(
    root,
    new Date().toISOString(),
    'idle'
  )
  scheduleIndex(root)
  return listIndexRoots()
}

export function removeIndexRoot(rawPath: string): IndexRootInfo[] {
  const root = normalizeAbsolute(rawPath)
  if (!root) throw new AppError('validation', `Not an absolute path: ${rawPath}`)
  const db = searchDb()
  db.prepare('DELETE FROM roots WHERE path = ?').run(root)
  return listIndexRoots()
}

export function scheduleIndex(rootPath?: string): { started: boolean } {
  const db = searchDb()
  if (rootPath) {
    const n = normalizeAbsolute(rootPath)
    if (!n) throw new AppError('validation', `Not an absolute path: ${rootPath}`)
    const row = db.prepare('SELECT * FROM roots WHERE path = ?').get(n) as unknown as
      RootRow | undefined
    if (!row) throw new AppError('not-found', `Not an indexed root: ${n}`)
    if (!queue.includes(row.path)) queue.push(row.path)
  } else {
    const rows = db.prepare('SELECT * FROM roots').all() as unknown as RootRow[]
    for (const r of rows) if (!queue.includes(r.path)) queue.push(r.path)
  }
  void pumpQueue()
  return { started: true }
}

export function cancelIndexing(): boolean {
  if (!indexing) return false
  cancelRequested = true
  return true
}

async function pumpQueue(): Promise<void> {
  if (indexing) return
  indexing = true
  try {
    let next: string | undefined
    while ((next = queue.shift()) !== undefined) {
      cancelRequested = false
      await indexOneRoot(next)
    }
  } finally {
    indexing = false
  }
}

function setRootStatus(rootPath: string, status: IndexRootStatus, indexedAt?: string): void {
  const db = searchDb()
  if (indexedAt) {
    db.prepare('UPDATE roots SET status = ?, last_indexed_at = ? WHERE path = ?').run(
      status,
      indexedAt,
      rootPath
    )
  } else {
    db.prepare('UPDATE roots SET status = ? WHERE path = ?').run(status, rootPath)
  }
}

async function indexOneRoot(rootPath: string): Promise<void> {
  const db = searchDb()
  const row = db.prepare('SELECT * FROM roots WHERE path = ?').get(rootPath) as unknown as
    RootRow | undefined
  if (!row) return

  setRootStatus(rootPath, 'indexing')
  broadcast({ type: 'index-progress', payload: { rootPath, processed: 0 } })

  const excludes = new Set(
    settingsStore()
      .get()
      .searchExcludeDirNames.map((n) => n.toLowerCase())
  )

  const insert = db.prepare(
    `INSERT INTO files (root_id, path, name, ext, size, mtime_ms, is_dir)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       root_id = excluded.root_id, name = excluded.name, ext = excluded.ext,
       size = excluded.size, mtime_ms = excluded.mtime_ms, is_dir = excluded.is_dir`
  )

  type Row = [string, string, string, number, number, number]
  let processed = 0
  let batch: Row[] = []
  const flush = (): void => {
    if (batch.length === 0) return
    db.exec('BEGIN')
    try {
      for (const [p, name, ext, size, mtime, isDir] of batch) {
        insert.run(row.id, p, name, ext, size, mtime, isDir)
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    batch = []
  }

  try {
    // Full rebuild for this root: drop old rows, then walk fresh.
    db.prepare('DELETE FROM files WHERE root_id = ?').run(row.id)

    const stack: string[] = [rootPath]
    while (stack.length > 0) {
      if (cancelRequested) {
        flush()
        setRootStatus(rootPath, 'idle')
        broadcast({ type: 'index-progress', payload: { rootPath, processed, done: true } })
        return
      }
      const dir = stack.pop()!
      let dirents
      try {
        dirents = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        continue // permission denied etc.
      }
      for (const d of dirents) {
        const full = path.join(dir, d.name)
        const isDir = d.isDirectory()
        if (isDir && excludes.has(d.name.toLowerCase())) continue
        let size = 0
        let mtime = 0
        if (!isDir) {
          try {
            const st = await fsp.stat(full)
            size = st.size
            mtime = st.mtimeMs
          } catch {
            continue
          }
        }
        const ext = isDir ? '' : path.extname(d.name).slice(1).toLowerCase()
        batch.push([full, d.name, ext, size, mtime, isDir ? 1 : 0])
        processed++
        if (batch.length >= 500) {
          flush()
          broadcast({ type: 'index-progress', payload: { rootPath, processed } })
          // Yield to the event loop so IPC stays responsive.
          await new Promise((r) => setImmediate(r))
        }
        if (isDir) stack.push(full)
      }
    }
    flush()
    setRootStatus(rootPath, 'ready', new Date().toISOString())
    broadcast({ type: 'index-progress', payload: { rootPath, processed, done: true } })
    logMain('info', `Indexed ${processed} entries under ${rootPath}`)
  } catch (e) {
    setRootStatus(rootPath, 'error')
    broadcast({ type: 'index-progress', payload: { rootPath, processed, done: true } })
    logMain('error', `Indexing failed for ${rootPath}: ${String(e)}`)
  }
}
