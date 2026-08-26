import { z } from 'zod'

export const gitRefKindSchema = z.enum(['head', 'branch', 'remote', 'tag', 'other'])
export type GitRefKind = z.infer<typeof gitRefKindSchema>

export const gitDecoratedRefSchema = z.object({
  name: z.string().min(1).max(512),
  kind: gitRefKindSchema,
  current: z.boolean().optional()
})
export type GitDecoratedRef = z.infer<typeof gitDecoratedRefSchema>

export const gitLogCommitSchema = z.object({
  hash: z.string().min(7).max(64),
  parents: z.array(z.string().min(7).max(64)).max(16),
  authorName: z.string().max(200),
  authorEmail: z.string().max(320),
  authorDate: z.number().int(),
  subject: z.string().max(2000),
  refs: z.array(gitDecoratedRefSchema).max(64)
})
export type GitLogCommit = z.infer<typeof gitLogCommitSchema>

export const gitLogRequestSchema = z.object({
  repoRoot: z.string().min(1),
  limit: z.number().int().min(20).max(500).optional(),
  skip: z.number().int().min(0).max(50_000).optional()
})

export const gitLogResultSchema = z.object({
  commits: z.array(gitLogCommitSchema),
  truncated: z.boolean(),
  head: z.string().nullable()
})
export type GitLogResult = z.infer<typeof gitLogResultSchema>

/** Parse decoration tokens from `git log --decorate=full` / `--format=%D`. */
export function parseDecorations(raw: string): GitDecoratedRef[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  const out: GitDecoratedRef[] = []
  const seen = new Set<string>()
  for (const part of trimmed.split(',').map((p) => p.trim()).filter(Boolean)) {
    let name = part
    let kind: GitRefKind
    let current = false
    if (/^HEAD\s*(?:->|→)\s*/.test(name)) {
      name = name.replace(/^HEAD\s*(?:->|→)\s*/, '').trim()
      kind = 'branch'
      current = true
    } else if (name === 'HEAD') {
      out.push({ name: 'HEAD', kind: 'head', current: true })
      continue
    } else if (name.startsWith('tag: ')) {
      name = name.slice(5).trim()
      kind = 'tag'
    } else if (name.startsWith('refs/tags/')) {
      name = name.slice('refs/tags/'.length)
      kind = 'tag'
    } else if (name.startsWith('refs/heads/')) {
      name = name.slice('refs/heads/'.length)
      kind = 'branch'
    } else if (name.startsWith('refs/remotes/')) {
      name = name.slice('refs/remotes/'.length)
      kind = 'remote'
    } else if (name.includes('/')) {
      kind = 'remote'
    } else {
      kind = 'branch'
    }
    name = name
      .replace(/^refs\/heads\//, '')
      .replace(/^refs\/remotes\//, '')
      .replace(/^refs\/tags\//, '')
    const key = `${kind}:${name}`
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push({ name, kind, current: current || undefined })
  }
  return out
}
