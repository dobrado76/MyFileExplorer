import path from 'node:path'
import { AppError } from '@shared/result'
import { normalizeAbsolute, isSameOrUnder } from '../security/paths'

/** Absolute paths under repoRoot → repo-relative forward-slash paths for git --. */
export function toRepoRelativePaths(repoRoot: string, absPaths: string[]): string[] {
  const root = normalizeAbsolute(repoRoot)
  if (!root) throw new AppError('validation', `Not an absolute path: ${repoRoot}`)
  const out: string[] = []
  for (const raw of absPaths) {
    const abs = normalizeAbsolute(raw)
    if (!abs) throw new AppError('validation', `Not an absolute path: ${raw}`)
    if (!isSameOrUnder(abs, root)) {
      throw new AppError('validation', `Path is outside the repository: ${raw}`)
    }
    let rel = path.relative(root, abs)
    if (!rel || rel.startsWith('..')) {
      throw new AppError('validation', `Path is outside the repository: ${raw}`)
    }
    rel = rel.replace(/\\/g, '/')
    out.push(rel)
  }
  return out
}

export function repoRelativeToAbsolute(repoRoot: string, rel: string): string {
  const root = normalizeAbsolute(repoRoot)
  if (!root) throw new AppError('validation', `Not an absolute path: ${repoRoot}`)
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (cleaned.includes('..')) throw new AppError('validation', 'Invalid relative path')
  return path.join(root, ...cleaned.split('/'))
}
