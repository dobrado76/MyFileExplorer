import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import { AppError } from '@shared/result'
import type { GitBranchInfo, GitCommandResult } from '@shared/schemas/git'
import { isValidCloneFolderName, looksLikeGitCloneUrl } from '@shared/gitCloneUrl'
import { settingsStore } from '../settings/store'
import { normalizeAbsolute } from '../security/paths'
import { openCommandLineHere } from '../shell/openCommandLine'
import { pathExists } from '../fs/list'
import { toRepoRelativePaths, repoRelativeToAbsolute } from './paths'
import { runGit } from './run'
import { getOrRefreshStatus, scheduleRefresh } from './cache'
import { assertGitReady } from './discover'

async function scratchDir(): Promise<string> {
  const dir = path.join(app.getPath('userData'), 'git-scratch')
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

async function withRefresh(
  repoRoot: string,
  fn: () => Promise<GitCommandResult>
): Promise<GitCommandResult> {
  await assertGitReady()
  const result = await fn()
  scheduleRefresh(repoRoot)
  void getOrRefreshStatus(repoRoot, { force: true }).catch(() => undefined)
  return result
}

function normalizeCommitHash(hash: string): string {
  return hash.trim().toLowerCase()
}

function shortHash(hash: string): string {
  return hash.slice(0, 7)
}

/** Commit a local tag points at, or null if the tag does not exist. */
async function localTagCommit(repoRoot: string, tag: string): Promise<string | null> {
  const result = await runGit({
    cwd: repoRoot,
    args: ['rev-parse', `refs/tags/${tag}^{commit}`],
    timeoutMs: 15_000
  })
  if (!result.success) return null
  const hash = result.stdout.trim()
  return hash.length >= 7 ? hash : null
}

/** Commit a remote tag points at (peeled), or null if absent. */
async function remoteTagCommit(
  repoRoot: string,
  remote: string,
  tag: string
): Promise<string | null> {
  const result = await runGit({
    cwd: repoRoot,
    args: ['ls-remote', '--tags', remote, `refs/tags/${tag}^{}`],
    timeoutMs: 60_000,
    interactiveAuth: true
  })
  if (!result.success) return null
  const line = result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) return null
  const hash = line.split(/\s+/)[0]?.trim()
  return hash && hash.length >= 7 ? hash : null
}

function tagPushFailure(
  created: GitCommandResult,
  pushed: GitCommandResult,
  remoteName: string,
  detail: string
): GitCommandResult {
  const hookHint = /pre-push|npm run check|husky|hook declined|hook failed/i.test(detail)
    ? '\n(A local pre-push hook rejected the tag push — fix the hook error, or push the tag from a terminal with --no-verify if intentional.)'
    : ''
  const existsHint = /already exists/i.test(detail)
    ? '\n(That tag name is already on the remote at a different commit — pick another name, delete the remote tag first, or confirm Replace on origin.)'
    : ''
  return {
    ...pushed,
    stdout: `${created.stdout}\n${pushed.stdout}`,
    stderr: `Tag created locally, but push to ${remoteName} failed:\n${detail}${existsHint}${hookHint}`.trim()
  }
}

export async function stagePaths(repoRoot: string, absPaths: string[]): Promise<GitCommandResult> {
  const rels = toRepoRelativePaths(repoRoot, absPaths)
  return withRefresh(repoRoot, () =>
    runGit({ cwd: repoRoot, args: ['add', '--', ...rels], timeoutMs: 120_000 })
  )
}

export async function unstagePaths(repoRoot: string, absPaths: string[]): Promise<GitCommandResult> {
  const rels = toRepoRelativePaths(repoRoot, absPaths)
  return withRefresh(repoRoot, async () => {
    const r = await runGit({
      cwd: repoRoot,
      args: ['restore', '--staged', '--', ...rels],
      timeoutMs: 120_000
    })
    if (r.success) return r
    return runGit({
      cwd: repoRoot,
      args: ['reset', 'HEAD', '--', ...rels],
      timeoutMs: 120_000
    })
  })
}

export async function discardPaths(repoRoot: string, absPaths: string[]): Promise<GitCommandResult> {
  const rels = toRepoRelativePaths(repoRoot, absPaths)
  return withRefresh(repoRoot, () =>
    runGit({ cwd: repoRoot, args: ['restore', '--', ...rels], timeoutMs: 120_000 })
  )
}

export async function commit(
  repoRoot: string,
  message: string,
  pushAfter?: boolean,
  stageAll?: boolean
): Promise<GitCommandResult> {
  await assertGitReady()
  let status = await getOrRefreshStatus(repoRoot, { force: true })
  if (stageAll || status.stagedCount < 1) {
    if (status.changedCount < 1 && status.stagedCount < 1) {
      throw new AppError('validation', 'Nothing to commit')
    }
    if (status.stagedCount < 1 || stageAll) {
      // Do not append bare `--` — some Git builds treat that as a pathspec error.
      const add = await runGit({
        cwd: repoRoot,
        args: ['add', '-A'],
        timeoutMs: 120_000
      })
      if (!add.success) return add
      status = await getOrRefreshStatus(repoRoot, { force: true })
    }
  }
  if (status.stagedCount < 1) {
    throw new AppError('validation', 'Nothing staged to commit')
  }
  const dir = await scratchDir()
  const msgFile = path.join(dir, `commit-msg-${Date.now()}.txt`)
  await fsp.writeFile(msgFile, message, 'utf8')
  try {
    const result = await runGit({
      cwd: repoRoot,
      args: ['commit', '-F', msgFile],
      timeoutMs: 120_000
    })
    if (!result.success) return result
    if (pushAfter) {
      const push = await runGit({
        cwd: repoRoot,
        args: ['push'],
        timeoutMs: 600_000,
        interactiveAuth: true
      })
      scheduleRefresh(repoRoot)
      await getOrRefreshStatus(repoRoot, { force: true }).catch(() => undefined)
      return push.success
        ? result
        : {
            ...push,
            stdout: `${result.stdout}\n${push.stdout}`,
            stderr: `Committed, but push failed:\n${(push.stderr || push.stdout).trim()}`.trim()
          }
    }
    scheduleRefresh(repoRoot)
    await getOrRefreshStatus(repoRoot, { force: true }).catch(() => undefined)
    return result
  } finally {
    await fsp.unlink(msgFile).catch(() => undefined)
  }
}

export async function fetch(repoRoot: string): Promise<GitCommandResult> {
  return withRefresh(repoRoot, () =>
    runGit({
      cwd: repoRoot,
      args: ['fetch', '--all', '--prune'],
      timeoutMs: 600_000,
      interactiveAuth: true
    })
  )
}

export async function pull(repoRoot: string): Promise<GitCommandResult> {
  return withRefresh(repoRoot, () =>
    runGit({
      cwd: repoRoot,
      args: ['pull'],
      timeoutMs: 600_000,
      interactiveAuth: true
    })
  )
}

export async function push(repoRoot: string): Promise<GitCommandResult> {
  return withRefresh(repoRoot, () =>
    runGit({
      cwd: repoRoot,
      args: ['push'],
      timeoutMs: 600_000,
      interactiveAuth: true
    })
  )
}

/** Commits on HEAD not yet on the upstream (for the Push confirm dialog). */
export async function listOutgoing(repoRoot: string): Promise<{
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  commits: { hash: string; subject: string }[]
}> {
  await assertGitReady()
  // Always refresh — opening Push right after Commit must not use a pre-commit cache.
  const status = await getOrRefreshStatus(repoRoot, { force: true })
  const branch = status.info.detachedHead ? null : status.info.branch
  const upstream = status.info.upstream ?? null
  const behind = status.info.behind ?? 0

  if (!upstream) {
    return { branch, upstream: null, ahead: 0, behind, commits: [] }
  }

  // Authoritative vs remote tip — do not trust cached ahead (race after commit).
  const [logResult, countResult] = await Promise.all([
    runGit({
      cwd: repoRoot,
      args: ['log', '--format=%H%x1f%s', `${upstream}..HEAD`, '--max-count=100'],
      timeoutMs: 30_000
    }),
    runGit({
      cwd: repoRoot,
      args: ['rev-list', '--count', `${upstream}..HEAD`],
      timeoutMs: 30_000
    })
  ])

  const commits = logResult.success
    ? logResult.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [hash, subject = ''] = line.split('\x1f')
          return { hash: hash ?? '', subject }
        })
        .filter((c) => c.hash.length >= 7)
    : []

  const counted = countResult.success ? Number.parseInt(countResult.stdout.trim(), 10) : NaN
  const ahead = Number.isFinite(counted) && counted >= 0 ? counted : commits.length

  return { branch, upstream, ahead, behind, commits }
}

export async function listBranches(repoRoot: string): Promise<GitBranchInfo[]> {
  await assertGitReady()
  const result = await runGit({
    cwd: repoRoot,
    args: ['branch', '--format=%(refname:short)%09%(upstream:short)%09%(HEAD)'],
    timeoutMs: 30_000
  })
  if (!result.success) {
    throw new AppError('io', result.stderr.trim() || 'Failed to list branches')
  }
  return result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, upstream, head] = line.split('\t')
      return {
        name: name ?? '',
        current: head === '*',
        upstream: upstream || undefined
      }
    })
    .filter((b) => b.name)
}

export async function switchBranch(repoRoot: string, branch: string): Promise<GitCommandResult> {
  return withRefresh(repoRoot, () =>
    runGit({ cwd: repoRoot, args: ['switch', '--', branch], timeoutMs: 120_000 })
  )
}

export async function createBranch(
  repoRoot: string,
  branch: string,
  switchTo: boolean,
  startPoint?: string
): Promise<GitCommandResult> {
  const start = startPoint?.trim()
  return withRefresh(repoRoot, () => {
    if (switchTo) {
      const args = start ? ['switch', '-c', branch, start] : ['switch', '-c', branch]
      return runGit({ cwd: repoRoot, args, timeoutMs: 60_000 })
    }
    const args = start ? ['branch', '--', branch, start] : ['branch', '--', branch]
    return runGit({ cwd: repoRoot, args, timeoutMs: 60_000 })
  })
}

export async function createTag(
  repoRoot: string,
  tag: string,
  commit: string,
  pushToRemote?: boolean,
  remote?: string,
  forceRemote?: boolean
): Promise<GitCommandResult> {
  await assertGitReady()
  const target = normalizeCommitHash(commit)
  const existingLocal = await localTagCommit(repoRoot, tag)
  if (existingLocal && normalizeCommitHash(existingLocal) !== target) {
    return {
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: `Tag ${tag} already exists locally at ${shortHash(existingLocal)}. Delete it first or choose another name.`
    }
  }

  let created: GitCommandResult = { success: true, exitCode: 0, stdout: '', stderr: '' }
  if (!existingLocal) {
    created = await runGit({
      cwd: repoRoot,
      args: ['tag', '--', tag, commit],
      timeoutMs: 30_000
    })
    if (!created.success) {
      scheduleRefresh(repoRoot)
      void getOrRefreshStatus(repoRoot, { force: true }).catch(() => undefined)
      return created
    }
  }

  if (!pushToRemote) {
    scheduleRefresh(repoRoot)
    void getOrRefreshStatus(repoRoot, { force: true }).catch(() => undefined)
    return created
  }

  const remoteName = remote?.trim() || 'origin'
  const existingRemote = await remoteTagCommit(repoRoot, remoteName, tag)
  if (existingRemote) {
    if (normalizeCommitHash(existingRemote) === target) {
      scheduleRefresh(repoRoot)
      void getOrRefreshStatus(repoRoot, { force: true }).catch(() => undefined)
      return {
        success: true,
        exitCode: 0,
        stdout: created.stdout,
        stderr: `Tag ${tag} is already on ${remoteName} at ${shortHash(existingRemote)}.`
      }
    }
    if (!forceRemote) {
      scheduleRefresh(repoRoot)
      void getOrRefreshStatus(repoRoot, { force: true }).catch(() => undefined)
      return {
        success: false,
        exitCode: 1,
        stdout: created.stdout,
        stderr:
          `Tag ${tag} already exists on ${remoteName} at ${shortHash(existingRemote)} (this commit is ${shortHash(commit)}). ` +
          `Pick another name, delete the remote tag, or replace it on the remote.`
      }
    }
  }

  const pushArgs = forceRemote
    ? ['push', '--force', remoteName, `refs/tags/${tag}:refs/tags/${tag}`]
    : ['push', remoteName, `refs/tags/${tag}:refs/tags/${tag}`]
  const pushed = await runGit({
    cwd: repoRoot,
    args: pushArgs,
    timeoutMs: 600_000,
    interactiveAuth: true
  })
  scheduleRefresh(repoRoot)
  void getOrRefreshStatus(repoRoot, { force: true }).catch(() => undefined)
  if (pushed.success) return created
  const detail = (pushed.stderr || pushed.stdout).trim() || 'Unknown push error'
  return tagPushFailure(created, pushed, remoteName, detail)
}

export async function deleteTag(
  repoRoot: string,
  tag: string,
  deleteRemote?: boolean,
  remote?: string
): Promise<GitCommandResult> {
  await assertGitReady()
  const local = await runGit({
    cwd: repoRoot,
    args: ['tag', '-d', '--', tag],
    timeoutMs: 30_000
  })
  if (!local.success) {
    scheduleRefresh(repoRoot)
    void getOrRefreshStatus(repoRoot, { force: true }).catch(() => undefined)
    return local
  }
  if (!deleteRemote) {
    scheduleRefresh(repoRoot)
    void getOrRefreshStatus(repoRoot, { force: true }).catch(() => undefined)
    return local
  }
  const remoteName = remote?.trim() || 'origin'
  const remoteDel = await runGit({
    cwd: repoRoot,
    args: ['push', remoteName, '--delete', `refs/tags/${tag}`],
    timeoutMs: 600_000,
    interactiveAuth: true
  })
  scheduleRefresh(repoRoot)
  void getOrRefreshStatus(repoRoot, { force: true }).catch(() => undefined)
  if (remoteDel.success) return local
  return {
    ...remoteDel,
    stdout: `${local.stdout}\n${remoteDel.stdout}`,
    stderr:
      `Tag deleted locally, but remote delete failed:\n${(remoteDel.stderr || remoteDel.stdout).trim()}`.trim()
  }
}

export async function checkoutCommit(
  repoRoot: string,
  commit: string
): Promise<GitCommandResult> {
  return withRefresh(repoRoot, async () => {
    const switched = await runGit({
      cwd: repoRoot,
      args: ['switch', '--detach', '--', commit],
      timeoutMs: 120_000
    })
    if (switched.success) return switched
    return runGit({
      cwd: repoRoot,
      args: ['checkout', '--detach', '--', commit],
      timeoutMs: 120_000
    })
  })
}

export async function mergeCommit(
  repoRoot: string,
  commit: string
): Promise<GitCommandResult> {
  return withRefresh(repoRoot, () =>
    runGit({ cwd: repoRoot, args: ['merge', '--', commit], timeoutMs: 600_000 })
  )
}

export async function rebaseOnto(
  repoRoot: string,
  onto: string
): Promise<GitCommandResult> {
  return withRefresh(repoRoot, () =>
    runGit({ cwd: repoRoot, args: ['rebase', '--', onto], timeoutMs: 600_000 })
  )
}

export async function resetToCommit(
  repoRoot: string,
  commit: string,
  mode: 'soft' | 'mixed' | 'hard'
): Promise<GitCommandResult> {
  const flag = mode === 'soft' ? '--soft' : mode === 'hard' ? '--hard' : '--mixed'
  return withRefresh(repoRoot, () =>
    runGit({ cwd: repoRoot, args: ['reset', flag, '--', commit], timeoutMs: 120_000 })
  )
}

export async function cherryPickCommit(
  repoRoot: string,
  commit: string
): Promise<GitCommandResult> {
  return withRefresh(repoRoot, () =>
    runGit({ cwd: repoRoot, args: ['cherry-pick', '--', commit], timeoutMs: 600_000 })
  )
}

export async function revertCommit(
  repoRoot: string,
  commit: string
): Promise<GitCommandResult> {
  return withRefresh(repoRoot, () =>
    runGit({
      cwd: repoRoot,
      args: ['revert', '--no-edit', '--', commit],
      timeoutMs: 600_000
    })
  )
}

export async function stash(
  repoRoot: string,
  message?: string,
  includeUntracked?: boolean
): Promise<GitCommandResult> {
  const args = ['stash', 'push']
  if (includeUntracked) args.push('-u')
  if (message?.trim()) args.push('-m', message.trim())
  return withRefresh(repoRoot, () => runGit({ cwd: repoRoot, args, timeoutMs: 120_000 }))
}

export async function stashPop(repoRoot: string): Promise<GitCommandResult> {
  return withRefresh(repoRoot, () =>
    runGit({ cwd: repoRoot, args: ['stash', 'pop'], timeoutMs: 120_000 })
  )
}

/**
 * Clone a remote into `parentDir/folderName` (must not already exist).
 * Auth uses Credential Manager / SSH when needed.
 */
export async function cloneRepository(
  parentDir: string,
  folderName: string,
  url: string
): Promise<{ path: string; success: boolean; stderr: string; stdout: string }> {
  await assertGitReady()
  const parent = normalizeAbsolute(parentDir)
  if (!parent) throw new AppError('validation', 'Invalid parent folder')

  const name = folderName.trim()
  if (!isValidCloneFolderName(name)) {
    throw new AppError('validation', 'Invalid folder name')
  }
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new AppError('validation', 'Invalid folder name')
  }

  const cloneUrl = url.trim()
  if (!looksLikeGitCloneUrl(cloneUrl)) {
    throw new AppError('validation', 'Enter a valid Git repository URL')
  }

  const dest = path.join(parent, name)
  if (await pathExists(dest)) {
    throw new AppError('conflict', `“${name}” already exists in this folder`)
  }

  const result = await runGit({
    cwd: parent,
    args: ['clone', '--', cloneUrl, name],
    timeoutMs: 600_000,
    interactiveAuth: true
  })

  if (!result.success) {
    // Best-effort cleanup if git left a partial directory
    try {
      await fsp.rm(dest, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    return {
      path: dest,
      success: false,
      stderr: result.stderr,
      stdout: result.stdout
    }
  }

  return { path: dest, success: true, stderr: result.stderr, stdout: result.stdout }
}

export async function showExternalDiff(
  repoRoot: string,
  absPath: string,
  opts?: { commit?: string; otherCommit?: string }
): Promise<{ launched: boolean; message?: string }> {
  await assertGitReady()
  const settings = settingsStore().get()
  const tool = settings.git?.diffTool
  if (!tool?.executable?.trim()) {
    throw new AppError('validation', 'Configure a diff tool in Settings → Git')
  }
  const [rel] = toRepoRelativePaths(repoRoot, [absPath])
  if (!rel) throw new AppError('validation', 'Invalid path')

  const dir = await scratchDir()
  const safeName = rel.replace(/[\\/]/g, '__')
  const stamp = Date.now()
  let left: string
  let right: string

  if (!opts?.commit) {
    const show = await runGit({
      cwd: repoRoot,
      args: ['show', `HEAD:${rel}`],
      timeoutMs: 60_000
    })
    if (!show.success) {
      throw new AppError('io', show.stderr.trim() || 'Could not read HEAD version')
    }
    left = path.join(dir, `HEAD-${stamp}-${safeName}`)
    await fsp.writeFile(left, show.stdout, 'utf8')
    right = absPath
  } else if (opts.otherCommit) {
    left = await exportRevToScratch(repoRoot, rel, opts.otherCommit, dir, stamp, safeName)
    right = await exportRevToScratch(repoRoot, rel, opts.commit, dir, stamp + 1, safeName)
  } else {
    const parentRes = await runGit({
      cwd: repoRoot,
      args: ['rev-parse', `${opts.commit}^`],
      timeoutMs: 15_000
    })
    const parent = parentRes.success ? parentRes.stdout.trim() : ''
    if (parent.length >= 7) {
      left = await exportRevToScratch(repoRoot, rel, parent, dir, stamp, safeName)
    } else {
      left = path.join(dir, `empty-${stamp}-${safeName}`)
      await fsp.writeFile(left, '', 'utf8')
    }
    right = await exportRevToScratch(repoRoot, rel, opts.commit, dir, stamp + 1, safeName)
  }

  launchDiffProcess(tool, repoRoot, rel, left, right)
  return { launched: true }
}

async function exportRevToScratch(
  repoRoot: string,
  rel: string,
  rev: string,
  dir: string,
  stamp: number,
  safeName: string
): Promise<string> {
  const dest = path.join(dir, `${shortHash(rev)}-${stamp}-${safeName}`)
  const show = await runGit({
    cwd: repoRoot,
    args: ['show', `${rev}:${rel}`],
    timeoutMs: 120_000
  })
  if (show.success) {
    await fsp.writeFile(dest, show.stdout, 'utf8')
  } else {
    await fsp.writeFile(dest, '', 'utf8')
  }
  return dest
}

function launchDiffProcess(
  tool: { executable: string; argsTemplate?: string },
  repoRoot: string,
  rel: string,
  left: string,
  right: string
): void {
  const template = tool.argsTemplate || '"{left}" "{right}"'
  const argsStr = template
    .replaceAll('{left}', left)
    .replaceAll('{right}', right)
    .replaceAll('{relativePath}', rel)
    .replaceAll('{repoRoot}', repoRoot)

  const argv = tokenizeArgs(argsStr)
  spawn(tool.executable.trim(), argv, {
    shell: false,
    windowsHide: true,
    detached: true,
    stdio: 'ignore'
  }).unref()
}

export async function openRepoTerminal(repoRoot: string): Promise<void> {
  const abs = normalizeAbsolute(repoRoot)
  if (!abs) throw new AppError('validation', 'Invalid repo root')
  await openCommandLineHere(abs)
}

function tokenizeArgs(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (ch === '"') {
      inQ = !inQ
      continue
    }
    if (!inQ && /\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

export { repoRelativeToAbsolute }
