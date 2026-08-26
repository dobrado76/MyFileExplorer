import { AppError } from '@shared/result'
import type { GitRepositoryStatus } from '@shared/schemas/git'
import { normalizeAbsolute } from '../security/paths'
import { settingsStore } from '../settings/store'
import { resolveGitExecutable } from './detect'
import { runGit } from './run'
import {
  buildFolderAggregates,
  infoFromParsed,
  parsePorcelainV2,
  summarizePaths
} from './statusParse'

export type DiscoverResult = {
  inRepo: boolean
  rootPath?: string
  gitDir?: string
}

export async function discoverRepo(cwdPath: string): Promise<DiscoverResult> {
  const abs = normalizeAbsolute(cwdPath)
  if (!abs) throw new AppError('validation', `Not an absolute path: ${cwdPath}`)
  const settings = settingsStore().get()
  if (settings.git?.enabled !== true) {
    return { inRepo: false }
  }
  const top = await runGit({
    cwd: abs,
    args: ['rev-parse', '--show-toplevel'],
    timeoutMs: 15_000
  })
  if (!top.success) return { inRepo: false }
  const rootPath = normalizeAbsolute(top.stdout.trim()) ?? top.stdout.trim()
  const gd = await runGit({
    cwd: rootPath,
    args: ['rev-parse', '--git-dir'],
    timeoutMs: 10_000
  })
  let gitDir = rootPath
  if (gd.success) {
    const raw = gd.stdout.trim()
    gitDir = normalizeAbsolute(raw) ?? (raw.includes(':') || raw.startsWith('/') || raw.startsWith('\\')
      ? raw
      : `${rootPath}\\${raw}`)
  }
  return { inRepo: true, rootPath, gitDir }
}

export async function fetchStatus(repoRoot: string): Promise<GitRepositoryStatus> {
  const abs = normalizeAbsolute(repoRoot)
  if (!abs) throw new AppError('validation', `Not an absolute path: ${repoRoot}`)
  const settings = settingsStore().get()
  if (settings.git?.enabled !== true) {
    throw new AppError('not-allowed', 'Git integration is disabled')
  }

  const showIgnored = settings.git.showIgnored === true
  const args = ['status', '--porcelain=v2', '-z', '--branch']
  if (showIgnored) args.push('--ignored=matching')

  const result = await runGit({ cwd: abs, args, timeoutMs: 120_000 })
  if (!result.success) {
    throw new AppError(
      'io',
      result.stderr.trim() || result.stdout.trim() || 'git status failed'
    )
  }

  const parsed = parsePorcelainV2(result.stdout)
  let paths = parsed.paths
  if (!showIgnored) {
    paths = paths.filter((p) => p.workingTree !== 'ignored')
  }

  const discover = await discoverRepo(abs)
  const gitDir = discover.gitDir ?? abs
  const now = Date.now()
  const info = infoFromParsed(abs, gitDir, parsed, now)
  const folders = buildFolderAggregates(paths)
  const summary = summarizePaths(paths)

  if (
    settings.git.suspendLargeRepos &&
    summary.changedCount >= (settings.git.largeRepoFileThreshold ?? 500_000)
  ) {
    // Still return status but mark via empty paths? Plan says suspend — keep data but callers can check.
  }

  return {
    info,
    paths,
    folders,
    ...summary
  }
}

export async function assertGitReady(): Promise<void> {
  const settings = settingsStore().get()
  if (settings.git?.enabled !== true) {
    throw new AppError('not-allowed', 'Git integration is disabled')
  }
  const exe = await resolveGitExecutable(settings.git.executablePath || '')
  if (!exe.found || !exe.path) {
    throw new AppError('not-found', exe.message || 'Git was not found')
  }
}
