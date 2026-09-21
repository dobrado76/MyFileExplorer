import type { GitRepositoryStatus } from '@shared/schemas/git'
import { isGitMissingRepoMessage } from '@shared/gitErrors'
import { settingsStore } from '../settings/store'
import { broadcast } from '../ipc/events'
import { discoverRepo, fetchStatus } from './discover'
import { normalizeAbsolute } from '../security/paths'

type CacheEntry = {
  status: GitRepositoryStatus
  inFlight?: Promise<GitRepositoryStatus>
  debounceTimer?: ReturnType<typeof setTimeout>
}

const byRoot = new Map<string, CacheEntry>()

function rootKey(repoRoot: string): string {
  const n = normalizeAbsolute(repoRoot)
  return (n ?? repoRoot).toLowerCase()
}

function emitStatus(status: GitRepositoryStatus): void {
  broadcast({ type: 'git-status', payload: { status } })
}

function emitCleared(rootPath: string): void {
  broadcast({ type: 'git-status-cleared', payload: { rootPath } })
}

function placeholderStatus(repoRoot: string): GitRepositoryStatus {
  return {
    info: {
      rootPath: repoRoot,
      gitDir: repoRoot,
      branch: null,
      detachedHead: false,
      lastStatusRefresh: 0
    },
    paths: [],
    folders: {},
    changedCount: 0,
    conflictCount: 0,
    stagedCount: 0,
    untrackedCount: 0
  }
}

export function getCachedStatus(repoRoot: string): GitRepositoryStatus | null {
  return byRoot.get(rootKey(repoRoot))?.status ?? null
}

export function invalidateRepo(repoRoot: string): void {
  const key = rootKey(repoRoot)
  const entry = byRoot.get(key)
  if (entry?.debounceTimer) clearTimeout(entry.debounceTimer)
  byRoot.delete(key)
}

/** Drop cache and tell every renderer the repo is gone (e.g. `.git` deleted). */
export function forgetRepo(repoRoot: string): void {
  invalidateRepo(repoRoot)
  emitCleared(repoRoot)
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** Forget every cached root that covers this browsing path. */
export function forgetReposCoveringPath(absPath: string): void {
  const abs = normalizeAbsolute(absPath)
  if (!abs) return
  const lower = abs.toLowerCase()
  const drop: string[] = []
  for (const entry of byRoot.values()) {
    const root = entry.status.info.rootPath
    const rootLower = root.toLowerCase()
    if (
      lower === rootLower ||
      lower.startsWith(rootLower + '\\') ||
      lower.startsWith(rootLower + '/')
    ) {
      drop.push(root)
    }
  }
  for (const root of drop) forgetRepo(root)
}

export function clearAllGitCache(): void {
  for (const entry of byRoot.values()) {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
  }
  byRoot.clear()
}

export async function getOrRefreshStatus(
  repoRoot: string,
  opts?: { force?: boolean }
): Promise<GitRepositoryStatus> {
  const key = rootKey(repoRoot)
  const existing = byRoot.get(key)
  if (!opts?.force && existing?.status) {
    return existing.status
  }
  if (existing?.inFlight) return existing.inFlight

  const promise = fetchStatus(repoRoot)
    .then((status) => {
      const cur = byRoot.get(key)
      byRoot.set(key, { status, inFlight: undefined, debounceTimer: cur?.debounceTimer })
      emitStatus(status)
      return status
    })
    .catch((err) => {
      const cur = byRoot.get(key)
      if (cur) cur.inFlight = undefined
      if (isGitMissingRepoMessage(errorMessage(err))) {
        forgetRepo(repoRoot)
      }
      throw err
    })

  byRoot.set(key, {
    status: existing?.status ?? placeholderStatus(repoRoot),
    inFlight: promise,
    debounceTimer: existing?.debounceTimer
  })
  return promise
}

export function scheduleRefresh(repoRoot: string): void {
  const settings = settingsStore().get()
  if (settings.git?.enabled !== true) return
  const ms = settings.git.refreshDebounceMs ?? 400
  const key = rootKey(repoRoot)
  const entry = byRoot.get(key) ?? {
    status: placeholderStatus(repoRoot)
  }
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = undefined
    void getOrRefreshStatus(repoRoot, { force: true }).catch((err) => {
      if (isGitMissingRepoMessage(errorMessage(err))) {
        forgetRepo(repoRoot)
      }
    })
  }, ms)
  byRoot.set(key, entry)
}

/** After FS events: if path is under a known root, debounce refresh. */
export function notifyPathChanged(absPath: string): void {
  const settings = settingsStore().get()
  if (settings.git?.enabled !== true) return
  const abs = normalizeAbsolute(absPath)
  if (!abs) return
  const lower = abs.toLowerCase()
  for (const [key, entry] of byRoot) {
    const root = entry.status.info.rootPath.toLowerCase()
    if (lower === root || lower.startsWith(root + '\\') || lower.startsWith(root + '/')) {
      scheduleRefresh(entry.status.info.rootPath)
      return
    }
    void key
  }
}

/** Discover + refresh for a browsing path; caches by repo root. */
export async function ensureStatusForPath(path: string): Promise<{
  inRepo: boolean
  status: GitRepositoryStatus | null
}> {
  const settings = settingsStore().get()
  if (settings.git?.enabled !== true) return { inRepo: false, status: null }
  const d = await discoverRepo(path)
  if (!d.inRepo || !d.rootPath) {
    forgetReposCoveringPath(path)
    return { inRepo: false, status: null }
  }
  try {
    const status = await getOrRefreshStatus(d.rootPath)
    return { inRepo: true, status }
  } catch (err) {
    if (isGitMissingRepoMessage(errorMessage(err))) {
      forgetRepo(d.rootPath)
      return { inRepo: false, status: null }
    }
    throw err
  }
}
