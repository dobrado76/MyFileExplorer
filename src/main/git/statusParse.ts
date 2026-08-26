/**
 * Parse `git status --porcelain=v2 -z --branch` into path status + folder aggregates.
 */
import type {
  GitFileState,
  GitFolderAggregateStatus,
  GitPathStatus,
  GitRepositoryInfo
} from '@shared/schemas/git'

const XY_MAP: Record<string, GitFileState> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'conflicted',
  T: 'modified',
  '?': 'untracked',
  '!': 'ignored',
  '.': 'clean',
  ' ': 'clean'
}

function mapXy(ch: string): GitFileState | null {
  if (!ch || ch === '.' || ch === ' ') return null
  return XY_MAP[ch] ?? 'modified'
}

export type ParsedPorcelain = {
  branch: string | null
  detachedHead: boolean
  upstream?: string
  ahead?: number
  behind?: number
  paths: GitPathStatus[]
}

export function parsePorcelainV2(stdout: string): ParsedPorcelain {
  const parts = stdout.split('\0').filter((p) => p.length > 0)
  let branch: string | null = null
  let detachedHead = false
  let upstream: string | undefined
  let ahead: number | undefined
  let behind: number | undefined
  const paths: GitPathStatus[] = []

  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]!
    if (line.startsWith('# branch.oid ')) continue
    if (line.startsWith('# branch.head ')) {
      const name = line.slice('# branch.head '.length).trim()
      if (name === '(detached)') {
        detachedHead = true
        branch = null
      } else {
        branch = name
        detachedHead = false
      }
      continue
    }
    if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length).trim()
      continue
    }
    if (line.startsWith('# branch.ab ')) {
      const m = /# branch\.ab \+(\d+) -(\d+)/.exec(line)
      if (m) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
      continue
    }
    if (line.startsWith('# ')) continue

    // Ordinary changed: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
    if (line.startsWith('1 ')) {
      const rest = line.slice(2)
      const xy = rest.slice(0, 2)
      const pathStart = findPathStartOrdinary(rest)
      const rel = rest.slice(pathStart).replace(/\\/g, '/')
      paths.push({
        relativePath: rel,
        staged: mapXy(xy[0]!),
        workingTree: mapXy(xy[1]!),
        conflicted: xy[0] === 'U' || xy[1] === 'U'
      })
      continue
    }

    // Rename/copy: 2 <XY> ... <score> <path>\0<orig>
    if (line.startsWith('2 ')) {
      const rest = line.slice(2)
      const xy = rest.slice(0, 2)
      const pathStart = findPathStartRename(rest)
      const rel = rest.slice(pathStart).replace(/\\/g, '/')
      const orig = (parts[++i] ?? '').replace(/\\/g, '/')
      paths.push({
        relativePath: rel,
        staged: mapXy(xy[0]!) ?? (xy[0] === 'R' || xy[0] === 'C' ? mapXy(xy[0]!) : null),
        workingTree: mapXy(xy[1]!),
        conflicted: false,
        originalPath: orig || undefined
      })
      // Prefer renamed/copied from XY
      const row = paths[paths.length - 1]!
      if (xy[0] === 'R') row.staged = 'renamed'
      if (xy[0] === 'C') row.staged = 'copied'
      continue
    }

    // Unmerged: u <XY> ...
    if (line.startsWith('u ')) {
      const rest = line.slice(2)
      const pathStart = findPathStartOrdinary(rest)
      const rel = rest.slice(pathStart).replace(/\\/g, '/')
      paths.push({
        relativePath: rel,
        staged: 'conflicted',
        workingTree: 'conflicted',
        conflicted: true
      })
      continue
    }

    // Untracked / ignored: ? path  / ! path
    if (line.startsWith('? ') || line.startsWith('! ')) {
      const rel = line.slice(2).replace(/\\/g, '/')
      const ignored = line.startsWith('! ')
      paths.push({
        relativePath: rel,
        staged: null,
        workingTree: ignored ? 'ignored' : 'untracked',
        conflicted: false
      })
    }
  }

  return { branch, detachedHead, upstream, ahead, behind, paths }
}

/** After XY and fixed fields, path begins. Ordinary: skip 2+1+3 octal modes + 2 hashes. */
function findPathStartOrdinary(rest: string): number {
  // XY(2) + space already consumed in caller for "1 " — rest is "XY sub mH mI mW hH hI path"
  // Format: XY SP sub SP mH SP mI SP mW SP hH SP hI SP path
  const parts = rest.split(' ')
  // XY, sub, mH, mI, mW, hH, hI, then path may contain spaces — join from index 7
  if (parts.length < 8) return rest.length
  let idx = 0
  for (let n = 0; n < 7; n++) {
    idx = rest.indexOf(' ', idx)
    if (idx < 0) return rest.length
    idx += 1
  }
  return idx
}

function findPathStartRename(rest: string): number {
  // XY SP sub SP mH SP mI SP mW SP hH SP hI SP Xscore SP path
  let idx = 0
  for (let n = 0; n < 8; n++) {
    idx = rest.indexOf(' ', idx)
    if (idx < 0) return rest.length
    idx += 1
  }
  return idx
}

export function buildFolderAggregates(
  paths: GitPathStatus[]
): Record<string, GitFolderAggregateStatus> {
  const folders: Record<string, GitFolderAggregateStatus> = {}
  const touch = (dir: string, patch: Partial<GitFolderAggregateStatus>): void => {
    const key = dir.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!key || key === '.') return
    const cur = folders[key] ?? {
      containsModified: false,
      containsStaged: false,
      containsUntracked: false,
      containsConflict: false
    }
    folders[key] = {
      containsModified: cur.containsModified || !!patch.containsModified,
      containsStaged: cur.containsStaged || !!patch.containsStaged,
      containsUntracked: cur.containsUntracked || !!patch.containsUntracked,
      containsConflict: cur.containsConflict || !!patch.containsConflict
    }
  }

  for (const p of paths) {
    const rel = p.relativePath.replace(/\\/g, '/')
    const slash = rel.lastIndexOf('/')
    if (slash <= 0) continue
    let dir = rel.slice(0, slash)
    const patch: Partial<GitFolderAggregateStatus> = {
      containsConflict: p.conflicted,
      containsUntracked: p.workingTree === 'untracked',
      containsStaged: p.staged != null && p.staged !== 'clean',
      containsModified:
        (p.workingTree != null &&
          p.workingTree !== 'clean' &&
          p.workingTree !== 'untracked' &&
          p.workingTree !== 'ignored') ||
        (p.staged != null && p.staged !== 'clean' && p.staged !== 'untracked')
    }
    while (dir) {
      touch(dir, patch)
      const i = dir.lastIndexOf('/')
      if (i <= 0) break
      dir = dir.slice(0, i)
    }
  }
  return folders
}

export function summarizePaths(paths: GitPathStatus[]): {
  changedCount: number
  conflictCount: number
  stagedCount: number
  untrackedCount: number
} {
  let changedCount = 0
  let conflictCount = 0
  let stagedCount = 0
  let untrackedCount = 0
  for (const p of paths) {
    if (p.conflicted) conflictCount++
    if (p.workingTree === 'untracked') untrackedCount++
    if (p.staged && p.staged !== 'clean') stagedCount++
    if (
      p.conflicted ||
      (p.staged && p.staged !== 'clean') ||
      (p.workingTree && p.workingTree !== 'clean' && p.workingTree !== 'ignored')
    ) {
      changedCount++
    }
  }
  return { changedCount, conflictCount, stagedCount, untrackedCount }
}

export function infoFromParsed(
  rootPath: string,
  gitDir: string,
  parsed: ParsedPorcelain,
  lastStatusRefresh: number
): GitRepositoryInfo {
  return {
    rootPath,
    gitDir,
    branch: parsed.detachedHead
      ? null
      : parsed.branch,
    detachedHead: parsed.detachedHead,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    lastStatusRefresh
  }
}
