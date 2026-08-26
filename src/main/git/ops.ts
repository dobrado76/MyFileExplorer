import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import { AppError } from '@shared/result'
import type { GitBranchInfo, GitCommandResult } from '@shared/schemas/git'
import { settingsStore } from '../settings/store'
import { normalizeAbsolute } from '../security/paths'
import { openCommandLineHere } from '../shell/openCommandLine'
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
      const add = await runGit({
        cwd: repoRoot,
        args: ['add', '-A', '--'],
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
        timeoutMs: 600_000
      })
      scheduleRefresh(repoRoot)
      void getOrRefreshStatus(repoRoot, { force: true }).catch(() => undefined)
      return push.success
        ? result
        : {
            ...push,
            stdout: `${result.stdout}\n${push.stdout}`,
            stderr: `${result.stderr}\n${push.stderr}`.trim()
          }
    }
    scheduleRefresh(repoRoot)
    void getOrRefreshStatus(repoRoot, { force: true }).catch(() => undefined)
    return result
  } finally {
    await fsp.unlink(msgFile).catch(() => undefined)
  }
}

export async function fetch(repoRoot: string): Promise<GitCommandResult> {
  return withRefresh(repoRoot, () =>
    runGit({ cwd: repoRoot, args: ['fetch', '--all', '--prune'], timeoutMs: 600_000 })
  )
}

export async function pull(repoRoot: string): Promise<GitCommandResult> {
  return withRefresh(repoRoot, () =>
    runGit({ cwd: repoRoot, args: ['pull'], timeoutMs: 600_000 })
  )
}

export async function push(repoRoot: string): Promise<GitCommandResult> {
  return withRefresh(repoRoot, () =>
    runGit({ cwd: repoRoot, args: ['push'], timeoutMs: 600_000 })
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
  const status = await getOrRefreshStatus(repoRoot, { force: false })
  const branch = status.info.detachedHead ? null : status.info.branch
  const upstream = status.info.upstream ?? null
  const ahead = status.info.ahead ?? 0
  const behind = status.info.behind ?? 0

  if (!upstream || ahead < 1) {
    return { branch, upstream, ahead, behind, commits: [] }
  }

  const result = await runGit({
    cwd: repoRoot,
    args: ['log', '--format=%H%x1f%s', `${upstream}..HEAD`, '--max-count=100'],
    timeoutMs: 30_000
  })
  if (!result.success) {
    return { branch, upstream, ahead, behind, commits: [] }
  }
  const commits = result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, subject = ''] = line.split('\x1f')
      return { hash: hash ?? '', subject }
    })
    .filter((c) => c.hash.length >= 7)

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
  commit: string
): Promise<GitCommandResult> {
  return withRefresh(repoRoot, () =>
    runGit({
      cwd: repoRoot,
      args: ['tag', '--', tag, commit],
      timeoutMs: 30_000
    })
  )
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

export async function showExternalDiff(
  repoRoot: string,
  absPath: string
): Promise<{ launched: boolean; message?: string }> {
  await assertGitReady()
  const settings = settingsStore().get()
  const tool = settings.git?.diffTool
  if (!tool?.executable?.trim()) {
    throw new AppError('validation', 'Configure a diff tool in Settings → Git')
  }
  const [rel] = toRepoRelativePaths(repoRoot, [absPath])
  if (!rel) throw new AppError('validation', 'Invalid path')

  const show = await runGit({
    cwd: repoRoot,
    args: ['show', `HEAD:${rel}`],
    timeoutMs: 60_000
  })
  if (!show.success) {
    throw new AppError('io', show.stderr.trim() || 'Could not read HEAD version')
  }

  const dir = await scratchDir()
  const safeName = rel.replace(/[\\/]/g, '__')
  const left = path.join(dir, `HEAD-${Date.now()}-${safeName}`)
  await fsp.writeFile(left, show.stdout, 'utf8')
  const right = absPath

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

  return { launched: true }
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
