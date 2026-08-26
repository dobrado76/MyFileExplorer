import { AppError } from '@shared/result'
import type { GitCommitDetail, GitCommitFileChange } from '@shared/schemas/gitLog'
import { normalizeAbsolute } from '../security/paths'
import { assertGitReady } from './discover'
import { runGit } from './run'

const RS = '\x1e'

function parseNameStatusLine(line: string): GitCommitFileChange | null {
  const tab = line.indexOf('\t')
  if (tab < 1) return null
  const status = line.slice(0, tab).trim()
  const rest = line.slice(tab + 1)
  if (!status || !rest) return null
  const code = status[0] ?? ''
  if (code === 'R' || code === 'C') {
    const parts = rest.split('\t')
    if (parts.length < 2) return null
    return { status: code, path: parts[1]!.trim(), oldPath: parts[0]!.trim() }
  }
  return { status: code, path: rest.trim() }
}

export async function fetchCommitDetail(
  repoRoot: string,
  commit: string
): Promise<GitCommitDetail> {
  await assertGitReady()
  const abs = normalizeAbsolute(repoRoot)
  if (!abs) throw new AppError('validation', `Not an absolute path: ${repoRoot}`)

  const hash = commit.trim()
  const fmt = ['%H', '%P', '%an', '%ae', '%at', '%s', '%B'].join(RS)
  const meta = await runGit({
    cwd: abs,
    args: ['log', '-1', `--pretty=format:${fmt}`, hash],
    timeoutMs: 60_000
  })
  if (!meta.success) {
    throw new AppError('io', meta.stderr.trim() || meta.stdout.trim() || 'git log failed')
  }

  const parts = meta.stdout.split(RS)
  if (parts.length < 6 || !parts[0]) {
    throw new AppError('io', 'Could not read commit metadata')
  }
  const [outHash, parentsRaw, authorName, authorEmail, atRaw, subject, ...bodyParts] = parts
  const body = bodyParts.join(RS).replace(/^\n+/, '').replace(/\n+$/, '')
  const parents = (parentsRaw ?? '')
    .trim()
    .split(/\s+/)
    .filter((p) => p.length >= 7)
  const authorDate = Number(atRaw)

  const tree = await runGit({
    cwd: abs,
    args: ['diff-tree', '--no-commit-id', '--name-status', '-r', outHash],
    timeoutMs: 120_000
  })
  if (!tree.success) {
    throw new AppError('io', tree.stderr.trim() || tree.stdout.trim() || 'git diff-tree failed')
  }

  const files: GitCommitFileChange[] = []
  for (const line of tree.stdout.split(/\r?\n/)) {
    const row = parseNameStatusLine(line)
    if (row) files.push(row)
  }

  return {
    hash: outHash,
    parents,
    authorName: authorName ?? '',
    authorEmail: authorEmail ?? '',
    authorDate: Number.isFinite(authorDate) ? authorDate : 0,
    subject: subject ?? '',
    body,
    files
  }
}
