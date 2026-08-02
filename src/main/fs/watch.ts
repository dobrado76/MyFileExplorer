import fs from 'node:fs'
import type { WebContents } from 'electron'
import { EVENT_CHANNEL } from '@shared/ipc/contract'
import { isSameOrUnder, pathKey } from '../security/paths'
import { requireAbsolute } from './list'

type WatcherEntry = { watcher: fs.FSWatcher; timer: NodeJS.Timeout | null; path: string }

/** Per-webContents map of watched dirs. */
const watchers = new Map<number, Map<string, WatcherEntry>>()

/** After in-app mutations we briefly mute events so listings don't double-refresh. */
let mutedUntil = 0
export function muteWatchers(ms = 400): void {
  mutedUntil = Date.now() + ms
}

export function watchDirectory(wc: WebContents, rawPath: string): { watching: true } {
  const dir = requireAbsolute(rawPath)
  const key = pathKey(dir)
  let byPath = watchers.get(wc.id)
  if (!byPath) {
    byPath = new Map()
    watchers.set(wc.id, byPath)
    wc.once('destroyed', () => {
      const map = watchers.get(wc.id)
      if (map) {
        for (const entry of map.values()) entry.watcher.close()
        watchers.delete(wc.id)
      }
    })
  }
  if (byPath.has(key)) return { watching: true }

  const entry: WatcherEntry = { watcher: fs.watch(dir), timer: null, path: dir }
  entry.watcher.on('change', (eventType) => {
    if (Date.now() < mutedUntil) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      if (!wc.isDestroyed()) {
        wc.send(EVENT_CHANNEL, {
          type: 'fs-changed',
          payload: { path: dir, reason: String(eventType) }
        })
      }
    }, 250)
  })
  entry.watcher.on('error', () => {
    entry.watcher.close()
    byPath.delete(key)
  })
  byPath.set(key, entry)
  return { watching: true }
}

export function unwatchDirectory(wc: WebContents, rawPath: string): { ok: true } {
  const dir = requireAbsolute(rawPath)
  const byPath = watchers.get(wc.id)
  const entry = byPath?.get(pathKey(dir))
  if (entry && byPath) {
    if (entry.timer) clearTimeout(entry.timer)
    entry.watcher.close()
    byPath.delete(pathKey(dir))
  }
  return { ok: true }
}

/**
 * Close watchers on `rawPath` and anything inside it so Windows will allow
 * rename/move/delete of that folder (our ReadDirectoryChanges handle otherwise
 * keeps it open — a common silent EPERM).
 */
export function releaseWatchersForTree(rawPath: string): void {
  const root = requireAbsolute(rawPath)
  for (const byPath of watchers.values()) {
    for (const [key, entry] of [...byPath.entries()]) {
      if (!isSameOrUnder(entry.path, root)) continue
      if (entry.timer) clearTimeout(entry.timer)
      try {
        entry.watcher.close()
      } catch {
        /* ignore */
      }
      byPath.delete(key)
    }
  }
}
