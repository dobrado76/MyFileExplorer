import fs from 'node:fs'
import type { WebContents } from 'electron'
import { EVENT_CHANNEL } from '@shared/ipc/contract'
import { isNetworkHostUnc } from '@shared/networkPaths'
import { isSameOrUnder, pathKey } from '../security/paths'
import { broadcast } from '../ipc/events'
import { requireAbsolute } from './list'

type WatcherEntry = { watcher: fs.FSWatcher; timer: NodeJS.Timeout | null; path: string }

/** Per-webContents map of watched dirs. */
const watchers = new Map<number, Map<string, WatcherEntry>>()

/** After in-app mutations we briefly mute events so listings don't double-refresh. */
let mutedUntil = 0
export function muteWatchers(ms = 400): void {
  mutedUntil = Date.now() + ms
}

/** Tell renderers a directory changed. Copy mkdir uses bypass so the tree/list update while muted. */
export function emitFsChanged(dirPath: string, opts?: { bypassMute?: boolean }): void {
  if (!opts?.bypassMute && Date.now() < mutedUntil) return
  try {
    const dir = requireAbsolute(dirPath)
    broadcast({ type: 'fs-changed', payload: { path: dir, reason: 'change' } })
  } catch {
    /* ignore */
  }
}

/**
 * While suspended, new watch requests are no-ops (still report success).
 * Prevents the renderer from re-arming ReadDirectoryChanges mid-Recycle.
 */
let watchSuspended = false
export function suspendWatching(): void {
  watchSuspended = true
  releaseAllWatchers()
}
export function resumeWatching(): void {
  watchSuspended = false
}
export function isWatchingSuspended(): boolean {
  return watchSuspended
}

export function watchDirectory(wc: WebContents, rawPath: string): { watching: true } {
  if (watchSuspended) return { watching: true }
  const dir = requireAbsolute(rawPath)
  // Bare `\\server` is not a real directory — fs.watch can fault on it.
  if (isNetworkHostUnc(dir)) return { watching: true }
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
    if (!wc.isDestroyed()) {
      wc.send(EVENT_CHANNEL, {
        type: 'fs-watch-lost',
        payload: { path: dir }
      })
    }
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
      closeEntry(byPath, key, entry)
    }
  }
}

/**
 * Close every watcher that could block recycling/deleting these paths:
 * the paths themselves, anything under them, **and ancestors** (we usually watch
 * the active folder — that parent handle routinely breaks Recycle Bin while
 * permanent unlink still succeeds).
 */
export function releaseWatchersAffecting(rawPaths: string[]): void {
  const targets = rawPaths.map((p) => requireAbsolute(p))
  for (const byPath of watchers.values()) {
    for (const [key, entry] of [...byPath.entries()]) {
      const hit = targets.some(
        (t) => isSameOrUnder(entry.path, t) || isSameOrUnder(t, entry.path)
      )
      if (!hit) continue
      closeEntry(byPath, key, entry)
    }
  }
}

/**
 * Close every directory watcher in the process. Recycle Bin (rename into
 * $Recycle.Bin) fails when *any* ReadDirectoryChanges handle is open on an
 * ancestor; permanent unlink often still succeeds — hence Del vs Shift+Del.
 */
export function releaseAllWatchers(): void {
  for (const byPath of watchers.values()) {
    for (const [key, entry] of [...byPath.entries()]) {
      closeEntry(byPath, key, entry)
    }
  }
}

function closeEntry(
  byPath: Map<string, WatcherEntry>,
  key: string,
  entry: WatcherEntry
): void {
  if (entry.timer) clearTimeout(entry.timer)
  try {
    entry.watcher.close()
  } catch {
    /* ignore */
  }
  byPath.delete(key)
}
