import { AppError } from '@shared/result'
import type { GitFileLogEntry, GitFileLogResult } from '@shared/schemas/gitLog'
import { normalizeAbsolute } from '../security/paths'
import { assertGitReady } from './discover'
import { toRepoRelativePaths } from './paths'
import { runGit } from './run'

const RS = '\x1e'

export async function fetchFileLog(
  repoRoot: string,
  absPath: string,
  opts?: { limit?: number; skip?: number }
): Promise<GitFileLogResult> {
  await assertGitReady()
  const abs = normalizeAbsolute(repoRoot)
  if (!abs) throw new AppError('validation', `Not an absolute path: ${repoRoot}`)

  const [rel] = toRepoRelativePaths(abs, [absPath])
  if (!rel) throw new AppError('validation', 'Path is outside the repository')

  const limit = opts?.limit ?? 150
  const skip = opts?.skip ?? 0
  const fmt = ['%H', '%at', '%s', '%an'].join(RS)
  const args = [
    'log',
    '--follow',
    '-M',
    `--max-count=${limit + 1}`,
    `--skip=${skip}`,
    `--pretty=format:${fmt}`,
    '--',
    rel
  ]

  const result = await runGit({ cwd: abs, args, timeoutMs: 120_000 })
  if (!result.success) {
    throw new AppError('io', result.stderr.trim() || result.stdout.trim() || 'git log failed')
  }

  const lines = result.stdout.split(/\r?\n/).filter((l) => l.length > 0)
  const truncated = lines.length > limit
  const slice = truncated ? lines.slice(0, limit) : lines
  const commits: GitFileLogEntry[] = []

  for (const line of slice) {
    const parts = line.split(RS)
    if (parts.length < 4) continue
    const [hash, atRaw, subject, authorName] = parts
    if (!hash) continue
    const authorDate = Number(atRaw)
    commits.push({
      hash,
      authorDate: Number.isFinite(authorDate) ? authorDate : 0,
      subject: subject ?? '',
      authorName: authorName ?? ''
    })
  }

  return { commits, truncated }
}
