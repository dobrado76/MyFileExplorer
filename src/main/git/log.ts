/**
 * Fetch commit history for the repo-root preview (Git Graph–style list).
 */
import { AppError } from '@shared/result'
import type { GitLogCommit, GitLogResult } from '@shared/schemas/gitLog'
import { parseDecorations } from '@shared/schemas/gitLog'
import { normalizeAbsolute } from '../security/paths'
import { assertGitReady } from './discover'
import { runGit } from './run'

const RS = '\x1e' // record separator between fields
const UNIT = '\x1f' // unused — keep fields simple with RS

export async function fetchGitLog(
  repoRoot: string,
  opts?: { limit?: number; skip?: number }
): Promise<GitLogResult> {
  await assertGitReady()
  const abs = normalizeAbsolute(repoRoot)
  if (!abs) throw new AppError('validation', `Not an absolute path: ${repoRoot}`)

  const limit = opts?.limit ?? 150
  const skip = opts?.skip ?? 0

  const headRes = await runGit({
    cwd: abs,
    args: ['rev-parse', 'HEAD'],
    timeoutMs: 15_000
  })
  const head = headRes.success ? headRes.stdout.trim() || null : null

  // %H hash, %P parents, %an author, %ae email, %at unix, %s subject, %D decorate
  const fmt = ['%H', '%P', '%an', '%ae', '%at', '%s', '%D'].join(RS)
  const args = [
    'log',
    '--date-order',
    `--max-count=${limit + 1}`,
    `--skip=${skip}`,
    `--pretty=format:${fmt}`,
    '--decorate=full',
    '--all'
  ]

  const result = await runGit({ cwd: abs, args, timeoutMs: 120_000 })
  if (!result.success) {
    throw new AppError('io', result.stderr.trim() || result.stdout.trim() || 'git log failed')
  }

  const lines = result.stdout.split(/\r?\n/).filter((l) => l.length > 0)
  const truncated = lines.length > limit
  const slice = truncated ? lines.slice(0, limit) : lines
  const commits: GitLogCommit[] = []

  for (const line of slice) {
    const parts = line.split(RS)
    if (parts.length < 6) continue
    const [hash, parentsRaw, authorName, authorEmail, atRaw, subject, deco = ''] = parts
    if (!hash) continue
    const parents = (parentsRaw ?? '')
      .trim()
      .split(/\s+/)
      .filter((p) => p.length >= 7)
    const authorDate = Number(atRaw)
    commits.push({
      hash,
      parents,
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      authorDate: Number.isFinite(authorDate) ? authorDate : 0,
      subject: subject ?? '',
      refs: parseDecorations(deco ?? '')
    })
  }

  void UNIT
  return { commits, truncated, head }
}
