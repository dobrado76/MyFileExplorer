import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import type {
  IndexRootInfo,
  IndexRootKind,
  IndexRootMonitor,
  IndexRootStatus
} from '@shared/schemas/search'
import { normalizeAbsolute, isSameOrUnder, pathKey } from '../security/paths'
import { settingsStore } from '../settings/store'
import { broadcast } from '../ipc/events'
import { logMain } from '../logging'
import { searchDb, type RootDbRow } from './db'
import { compilePathPatterns } from '@shared/pathPatterns'
import { fileRowFromPath, upsertFileRows } from './upsert'
import { syncRootWatches, stopRootWatch } from './rootWatch'
import {
  bootstrapVolumeUsn,
  isDriveRootPath,
  normalizeDriveRoot,
  startUsnPoller,
  stopUsnPoller
} from './ntfs/volumeIndex'

let indexing = false
let cancelRequested = false
const queue: string[] = []
let pollerStarted = false

function ensurePoller(): void {
  if (pollerStarted) return
  pollerStarted = true
  startUsnPoller(() => {
    const db = searchDb()
    return db
      .prepare(
        `SELECT id, path, usn_journal_id, usn_next, status, monitor FROM roots WHERE kind = 'volume'`
      )
      .all() as {
      id: number
      path: string
      usn_journal_id: string | null
      usn_next: number
      status: string
      monitor: string
    }[]
  })
}

export function listIndexRoots(): IndexRootInfo[] {
  const db = searchDb()
  const rows = db.prepare('SELECT * FROM roots ORDER BY path').all() as unknown as RootDbRow[]
  const countStmt = db.prepare('SELECT COUNT(*) AS c FROM files WHERE root_id = ?')
  return rows.map((r) => ({
    path: r.path,
    kind: (r.kind === 'volume' ? 'volume' : 'folder') as IndexRootKind,
    volume: r.volume,
    monitor: (r.monitor || 'none') as IndexRootMonitor,
    status: r.status as IndexRootStatus,
    addedAt: r.added_at,
    lastIndexedAt: r.last_indexed_at,
    fileCount: Number((countStmt.get(r.id) as { c: number } | undefined)?.c ?? 0)
  }))
}

export function addIndexRoot(
  rawPath: string,
  opts?: { kind?: IndexRootKind }
): IndexRootInfo[] {
  let root = normalizeAbsolute(rawPath)
  if (!root) throw new AppError('validation', `Not an absolute path: ${rawPath}`)

  const kind: IndexRootKind =
    opts?.kind ?? (isDriveRootPath(root) ? 'volume' : 'folder')
  if (kind === 'volume') root = normalizeDriveRoot(root)

  const db = searchDb()
  const rows = db.prepare('SELECT * FROM roots').all() as unknown as RootDbRow[]

  const covering = rows.find((r) => isSameOrUnder(root, r.path))
  if (covering) {
    throw new AppError(
      'conflict',
      `Already covered by indexed root "${covering.path}"`,
      'Remove the parent root first if you want to index this path separately.'
    )
  }
  for (const r of rows) {
    if (isSameOrUnder(r.path, root) && pathKey(r.path) !== pathKey(root)) {
      stopRootWatch(r.path)
      db.prepare('DELETE FROM roots WHERE id = ?').run(r.id)
      logMain('info', `Index root "${r.path}" absorbed by new parent "${root}"`)
    }
  }

  const volume = kind === 'volume' ? root.slice(0, 2).toUpperCase() : null
  const monitor: IndexRootMonitor = kind === 'volume' ? 'usn' : 'watch'

  db.prepare(
    `INSERT INTO roots (path, kind, volume, monitor, added_at, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(root, kind, volume, monitor, new Date().toISOString(), 'idle')

  scheduleIndex(root)
  ensurePoller()
  return listIndexRoots()
}

export function addVolumeRoot(rawPath: string): IndexRootInfo[] {
  return addIndexRoot(rawPath, { kind: 'volume' })
}

export function removeIndexRoot(rawPath: string): IndexRootInfo[] {
  const root = normalizeAbsolute(rawPath)
  if (!root) throw new AppError('validation', `Not an absolute path: ${rawPath}`)
  const db = searchDb()
  stopRootWatch(root)
  // Also try drive-normalized form
  if (isDriveRootPath(root)) stopRootWatch(normalizeDriveRoot(root))
  db.prepare('DELETE FROM roots WHERE path = ? OR path = ?').run(root, normalizeDriveRoot(root))
  syncRootWatches()
  return listIndexRoots()
}

export function scheduleIndex(rootPath?: string): { started: boolean } {
  const db = searchDb()
  if (rootPath) {
    const n = normalizeAbsolute(rootPath)
    if (!n) throw new AppError('validation', `Not an absolute path: ${rootPath}`)
    const candidates = [n, normalizeDriveRoot(n)]
    let row: RootDbRow | undefined
    for (const c of candidates) {
      row = db.prepare('SELECT * FROM roots WHERE path = ?').get(c) as unknown as
        | RootDbRow
        | undefined
      if (row) break
    }
    if (!row) throw new AppError('not-found', `Not an indexed root: ${n}`)
    if (!queue.includes(row.path)) queue.push(row.path)
  } else {
    const rows = db.prepare('SELECT * FROM roots').all() as unknown as RootDbRow[]
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
    syncRootWatches()
    ensurePoller()
  }
}

function setRootStatus(
  rootPath: string,
  status: IndexRootStatus,
  extras?: {
    indexedAt?: string
    monitor?: IndexRootMonitor
    journalId?: string | null
    nextUsn?: number
  }
): void {
  const db = searchDb()
  db.prepare(
    `UPDATE roots SET status = ?,
      last_indexed_at = COALESCE(?, last_indexed_at),
      monitor = COALESCE(?, monitor),
      usn_journal_id = COALESCE(?, usn_journal_id),
      usn_next = COALESCE(?, usn_next)
     WHERE path = ?`
  ).run(
    status,
    extras?.indexedAt ?? null,
    extras?.monitor ?? null,
    extras?.journalId ?? null,
    extras?.nextUsn ?? null,
    rootPath
  )
}

async function walkIndex(
  rootId: number,
  rootPath: string,
  onProgress: (n: number) => void
): Promise<number> {
  const excluded = compilePathPatterns(settingsStore().get().searchExcludeDirNames)
  let processed = 0
  let batch: ReturnType<typeof fileRowFromPath>[] = []
  const flush = (): void => {
    if (!batch.length) return
    upsertFileRows(rootId, batch)
    batch = []
  }

  const stack: string[] = [rootPath]
  while (stack.length > 0) {
    if (cancelRequested) {
      flush()
      return processed
    }
    const dir = stack.pop()!
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const d of dirents) {
      const full = path.join(dir, d.name)
      const isDir = d.isDirectory()
      if (excluded(full)) continue
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
      batch.push(fileRowFromPath(full, isDir, size, mtime))
      processed++
      if (batch.length >= 500) {
        flush()
        onProgress(processed)
        await new Promise((r) => setImmediate(r))
      }
      if (isDir) stack.push(full)
    }
  }
  flush()
  return processed
}

async function indexOneRoot(rootPath: string): Promise<void> {
  const db = searchDb()
  const row = db.prepare('SELECT * FROM roots WHERE path = ?').get(rootPath) as unknown as
    | RootDbRow
    | undefined
  if (!row) return

  setRootStatus(rootPath, 'indexing')
  broadcast({ type: 'index-progress', payload: { rootPath, processed: 0 } })

  try {
    db.prepare('DELETE FROM files WHERE root_id = ?').run(row.id)

    let processed = 0
    if (row.kind === 'volume') {
      const usn = await bootstrapVolumeUsn(
        row.id,
        rootPath,
        () => cancelRequested,
        (n) => {
          processed = n
          broadcast({ type: 'index-progress', payload: { rootPath, processed: n } })
        }
      )
      if (cancelRequested) {
        setRootStatus(rootPath, 'idle')
        broadcast({ type: 'index-progress', payload: { rootPath, processed, done: true } })
        return
      }
      if (usn.ok) {
        setRootStatus(rootPath, 'ready', {
          indexedAt: new Date().toISOString(),
          monitor: 'usn',
          journalId: usn.journalId,
          nextUsn: usn.nextUsn
        })
        broadcast({
          type: 'index-progress',
          payload: { rootPath, processed: usn.processed, done: true }
        })
        logMain('info', `Volume USN indexed ${usn.processed} under ${rootPath}`)
        return
      }
      // Fallback walk
      logMain('info', `USN unavailable for ${rootPath} — walking volume`)
      processed = await walkIndex(row.id, rootPath, (n) =>
        broadcast({ type: 'index-progress', payload: { rootPath, processed: n } })
      )
      if (cancelRequested) {
        setRootStatus(rootPath, 'idle')
        broadcast({ type: 'index-progress', payload: { rootPath, processed, done: true } })
        return
      }
      setRootStatus(rootPath, 'ready', {
        indexedAt: new Date().toISOString(),
        monitor: 'walk',
        journalId: null,
        nextUsn: 0
      })
      broadcast({ type: 'index-progress', payload: { rootPath, processed, done: true } })
      return
    }

    // Folder root — walk + watch
    processed = await walkIndex(row.id, rootPath, (n) =>
      broadcast({ type: 'index-progress', payload: { rootPath, processed: n } })
    )
    if (cancelRequested) {
      setRootStatus(rootPath, 'idle')
      broadcast({ type: 'index-progress', payload: { rootPath, processed, done: true } })
      return
    }
    setRootStatus(rootPath, 'ready', {
      indexedAt: new Date().toISOString(),
      monitor: 'watch'
    })
    broadcast({ type: 'index-progress', payload: { rootPath, processed, done: true } })
    logMain('info', `Indexed ${processed} entries under ${rootPath}`)
  } catch (e) {
    setRootStatus(rootPath, 'error')
    broadcast({ type: 'index-progress', payload: { rootPath, processed: 0, done: true } })
    logMain('error', `Indexing failed for ${rootPath}: ${String(e)}`)
  }
}

/** Call once after app ready. */
export function initSearchIndexRuntime(): void {
  searchDb()
  syncRootWatches()
  ensurePoller()
}

export function shutdownSearchIndexRuntime(): void {
  stopUsnPoller()
  pollerStarted = false
  void import('./rootWatch').then((m) => m.stopAllRootWatches())
}
