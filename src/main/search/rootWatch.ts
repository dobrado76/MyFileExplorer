/**
 * Debounced FS watch on folder index roots → incremental upsert/delete (D34).
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { compilePathPatterns } from '@shared/pathPatterns'
import { logMain } from '../logging'
import { settingsStore } from '../settings/store'
import { searchDb, type RootDbRow } from './db'
import { deletePathTree, fileRowFromPath, upsertFileRows } from './upsert'

const DEBOUNCE_MS = 400
const watchers = new Map<string, FSWatcher>()
const pending = new Map<string, Map<string, ReturnType<typeof setTimeout>>>()

function isSearchExcluded(fullPath: string): boolean {
  return compilePathPatterns(settingsStore().get().searchExcludeDirNames)(fullPath)
}

function rootForPath(filePath: string): RootDbRow | null {
  const db = searchDb()
  const rows = db
    .prepare(`SELECT * FROM roots WHERE kind = 'folder' AND monitor = 'watch' AND status = 'ready'`)
    .all() as unknown as RootDbRow[]
  const key = filePath.toLowerCase()
  let best: RootDbRow | null = null
  for (const r of rows) {
    const rp = r.path.toLowerCase().replace(/[\\/]+$/, '')
    if (key === rp || key.startsWith(rp + '\\') || key.startsWith(rp + '/')) {
      if (!best || r.path.length > best.path.length) best = r
    }
  }
  return best
}

async function applyChange(root: RootDbRow, fullPath: string): Promise<void> {
  if (isSearchExcluded(fullPath)) {
    deletePathTree(fullPath)
    return
  }
  try {
    const st = await fsp.stat(fullPath)
    const isDir = st.isDirectory()
    upsertFileRows(root.id, [
      fileRowFromPath(fullPath, isDir, st.size, st.mtimeMs)
    ])
  } catch {
    deletePathTree(fullPath)
  }
}

function schedule(rootPath: string, fullPath: string): void {
  let map = pending.get(rootPath)
  if (!map) {
    map = new Map()
    pending.set(rootPath, map)
  }
  const prev = map.get(fullPath)
  if (prev) clearTimeout(prev)
  map.set(
    fullPath,
    setTimeout(() => {
      map!.delete(fullPath)
      const root = rootForPath(fullPath)
      if (!root) return
      void applyChange(root, fullPath)
    }, DEBOUNCE_MS)
  )
}

export function startRootWatch(rootPath: string): void {
  stopRootWatch(rootPath)
  try {
    const w = watch(rootPath, { recursive: true }, (_evt, filename) => {
      if (!filename) return
      const full = path.join(rootPath, filename)
      schedule(rootPath, full)
    })
    w.on('error', (e) => {
      logMain('warn', `Index watch error ${rootPath}: ${String(e)}`)
      stopRootWatch(rootPath)
    })
    watchers.set(rootPath.toLowerCase(), w)
    logMain('info', `Index watch started: ${rootPath}`)
  } catch (e) {
    logMain('warn', `Could not watch indexed root ${rootPath}: ${String(e)}`)
  }
}

export function stopRootWatch(rootPath: string): void {
  const key = rootPath.toLowerCase()
  const w = watchers.get(key)
  if (w) {
    try {
      w.close()
    } catch {
      /* ignore */
    }
    watchers.delete(key)
  }
  const map = pending.get(rootPath)
  if (map) {
    for (const t of map.values()) clearTimeout(t)
    pending.delete(rootPath)
  }
}

export function stopAllRootWatches(): void {
  for (const p of [...watchers.keys()]) stopRootWatch(p)
}

/** Sync watches to ready folder roots with monitor=watch. */
export function syncRootWatches(): void {
  const db = searchDb()
  const rows = db
    .prepare(
      `SELECT path FROM roots WHERE kind = 'folder' AND monitor = 'watch' AND status = 'ready'`
    )
    .all() as { path: string }[]
  const want = new Set(rows.map((r) => r.path.toLowerCase()))
  for (const key of [...watchers.keys()]) {
    if (!want.has(key)) {
      const pathMatch = rows.find((r) => r.path.toLowerCase() === key)?.path ?? key
      stopRootWatch(pathMatch)
    }
  }
  for (const r of rows) {
    if (!watchers.has(r.path.toLowerCase())) startRootWatch(r.path)
  }
}
