/** Renderer helpers for Git status lookup (cache + path → relative). */

import type {
  GitFileState,
  GitFolderAggregateStatus,
  GitPathStatus,
  GitRepositoryStatus
} from '@shared/schemas/git'
import { gitStatusLabel, primaryGitState } from '@shared/schemas/git'
import { isRemoteLocation } from '@shared/remotePaths'
import { isUnderPath, normalizeSlashes, samePath, stripTrailingSep } from './paths'

export function gitRootKey(rootPath: string): string {
  return stripTrailingSep(normalizeSlashes(rootPath)).toLowerCase()
}

/** Absolute path → repo-relative forward-slash path, or null if outside root. */
export function toRepoRelative(repoRoot: string, absPath: string): string | null {
  if (isRemoteLocation(absPath) || isRemoteLocation(repoRoot)) return null
  if (samePath(repoRoot, absPath)) return ''
  if (!isUnderPath(absPath, repoRoot)) return null
  const root = stripTrailingSep(normalizeSlashes(repoRoot))
  const abs = stripTrailingSep(normalizeSlashes(absPath))
  const rootKey = root.toLowerCase()
  const absKey = abs.toLowerCase()
  if (absKey === rootKey) return ''
  const prefix = rootKey.endsWith('\\') ? rootKey : rootKey + '\\'
  if (!absKey.startsWith(prefix) && !absKey.startsWith(rootKey + '/')) {
    // Windows: already covered by isUnderPath; keep POSIX '/' roots
    if (!(root.startsWith('/') && abs.startsWith(root + '/'))) return null
  }
  let rel: string
  if (root.startsWith('/') && abs.startsWith('/')) {
    rel = abs.slice(root.length).replace(/^\/+/, '')
  } else {
    rel = abs.slice(root.length).replace(/^[\\/]+/, '')
  }
  return rel.replace(/\\/g, '/')
}

export type GitPathLookup = {
  rootPath: string
  status: GitRepositoryStatus
  relativePath: string
  pathRow: GitPathStatus | null
  folderAgg: GitFolderAggregateStatus | null
}

/** Longest matching repo root that contains `absPath`. */
export function lookupGitForPath(
  gitByRoot: Record<string, GitRepositoryStatus>,
  absPath: string
): GitPathLookup | null {
  if (!absPath || isRemoteLocation(absPath)) return null
  let best: GitPathLookup | null = null
  for (const status of Object.values(gitByRoot)) {
    const root = status.info.rootPath
    if (!samePath(absPath, root) && !isUnderPath(absPath, root)) continue
    const relativePath = toRepoRelative(root, absPath)
    if (relativePath == null) continue
    if (best && best.rootPath.length >= root.length) continue
    const pathRow =
      status.paths.find((p) => p.relativePath.replace(/\\/g, '/') === relativePath) ?? null
    const folderAgg = relativePath ? (status.folders[relativePath] ?? null) : null
    best = { rootPath: root, status, relativePath, pathRow, folderAgg }
  }
  return best
}

export function gitMarkerLetter(state: GitFileState): string {
  switch (state) {
    case 'conflicted':
      return '!'
    case 'deleted':
      return 'D'
    case 'added':
      return 'A'
    case 'modified':
      return 'M'
    case 'renamed':
    case 'copied':
      return 'R'
    case 'untracked':
      return 'U'
    case 'ignored':
      return 'I'
    default:
      return ''
  }
}

export function gitMarkerClass(state: GitFileState): string {
  switch (state) {
    case 'conflicted':
      return 'git-status-conflicted'
    case 'deleted':
      return 'git-status-deleted'
    case 'added':
      return 'git-status-added'
    case 'modified':
      return 'git-status-modified'
    case 'renamed':
    case 'copied':
      return 'git-status-renamed'
    case 'untracked':
      return 'git-status-untracked'
    case 'ignored':
      return 'git-status-ignored'
    default:
      return ''
  }
}

export function folderAggregatePrimary(
  agg: GitFolderAggregateStatus
): 'conflicted' | 'modified' | 'untracked' | null {
  if (agg.containsConflict) return 'conflicted'
  if (agg.containsModified || agg.containsStaged) return 'modified'
  if (agg.containsUntracked) return 'untracked'
  return null
}

export function entryGitOverlay(
  lookup: GitPathLookup | null,
  opts: { isDir: boolean; showOverlays: boolean; showFolderIndicators: boolean; showIgnored: boolean }
): { letter: string; className: string; label: string } | null {
  if (!lookup || !opts.showOverlays) return null
  if (opts.isDir && opts.showFolderIndicators && lookup.folderAgg) {
    const prim = folderAggregatePrimary(lookup.folderAgg)
    if (!prim) return null
    const state: GitFileState = prim === 'conflicted' ? 'conflicted' : prim === 'untracked' ? 'untracked' : 'modified'
    return {
      letter: '●',
      className: gitMarkerClass(state),
      label: 'Contains Git changes'
    }
  }
  if (opts.isDir) return null
  const row = lookup.pathRow
  if (!row) return null
  const state = primaryGitState(row)
  if (state === 'clean') return null
  if (state === 'ignored' && !opts.showIgnored) return null
  const letter = gitMarkerLetter(state)
  if (!letter) return null
  return {
    letter,
    className: gitMarkerClass(state),
    label: gitStatusLabel(row)
  }
}

export { gitStatusLabel, primaryGitState }
