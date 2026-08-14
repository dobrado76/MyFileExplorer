import type { ErrCode } from './result'
import type { ConflictPolicy } from './schemas/fs'

export const OP_ISSUE_KINDS = [
  'name_conflict',
  'busy',
  'not_allowed',
  'not_found',
  'path_too_long',
  'io',
  'fatal'
] as const
export type OpIssueKind = (typeof OP_ISSUE_KINDS)[number]

export type OpIssue = {
  kind: OpIssueKind
  code: ErrCode
  source: string
  dest?: string
  message: string
  sourceMtimeMs?: number
  destMtimeMs?: number
}

export type IssueDecision = 'replace' | 'skip' | 'rename' | 'keep_newer' | 'retry'

export type OpIssueGroup = { kind: OpIssueKind; label: string; items: OpIssue[] }

const KIND_LABEL: Record<OpIssueKind, string> = {
  name_conflict: 'Already exist',
  busy: 'In use',
  not_allowed: 'Access denied',
  not_found: 'No longer exist',
  path_too_long: 'Path too long',
  io: 'Could not complete',
  fatal: 'Stopped (disk full or destination missing)'
}

export function issueKindLabel(kind: OpIssueKind): string {
  return KIND_LABEL[kind]
}

export function issueKey(issue: Pick<OpIssue, 'source' | 'dest'>): string {
  return `${issue.source}\0${issue.dest ?? ''}`
}

export type IssueAction = { decision: IssueDecision; label: string }

/** Review-UI actions for a similar-issue group. */
export function actionsForKind(kind: OpIssueKind): IssueAction[] {
  switch (kind) {
    case 'name_conflict':
      return [
        { decision: 'skip', label: 'Skip' },
        { decision: 'rename', label: 'Keep both' },
        { decision: 'replace', label: 'Replace' },
        { decision: 'keep_newer', label: 'Keep most recent' }
      ]
    case 'busy':
    case 'not_allowed':
    case 'io':
    case 'fatal':
      return [
        { decision: 'retry', label: 'Retry' },
        { decision: 'skip', label: 'Skip' }
      ]
    case 'not_found':
    case 'path_too_long':
      return [{ decision: 'skip', label: 'Skip' }]
  }
}

/** Map AppError / Node errno to a review-UI kind. */
export function classifyOpIssue(code: string, errno?: string | null): OpIssueKind {
  const e = (errno ?? '').toUpperCase()
  if (e === 'ENOSPC' || e === 'EDQUOT' || e === 'EROFS') return 'fatal'
  if (e === 'ENAMETOOLONG') return 'path_too_long'
  if (code === 'conflict') return 'name_conflict'
  if (code === 'busy') return 'busy'
  if (code === 'not-allowed') return 'not_allowed'
  if (code === 'not-found') return 'not_found'
  if (code === 'cancelled') return 'fatal'
  return 'io'
}

/**
 * Keep the newer mtime. Equal times → keep both (rename incoming).
 * Dest newer → skip. Source newer → replace.
 */
export function applyKeepNewer(
  sourceMtimeMs: number,
  destMtimeMs: number
): 'replace' | 'skip' | 'rename' {
  if (sourceMtimeMs > destMtimeMs) return 'replace'
  if (sourceMtimeMs < destMtimeMs) return 'skip'
  return 'rename'
}

export function groupOpIssues(issues: OpIssue[]): OpIssueGroup[] {
  const map = new Map<OpIssueKind, OpIssue[]>()
  for (const it of issues) {
    const list = map.get(it.kind)
    if (list) list.push(it)
    else map.set(it.kind, [it])
  }
  return OP_ISSUE_KINDS.filter((k) => map.has(k)).map((kind) => ({
    kind,
    label: KIND_LABEL[kind],
    items: map.get(kind)!
  }))
}

export function shouldQueueNameConflict(policy: ConflictPolicy, destExists: boolean): boolean {
  return destExists && policy === 'fail'
}

export function resolveIssueDecision(
  decision: IssueDecision,
  issue: Pick<OpIssue, 'sourceMtimeMs' | 'destMtimeMs'>
): Exclude<IssueDecision, 'keep_newer'> {
  if (decision !== 'keep_newer') return decision
  return applyKeepNewer(issue.sourceMtimeMs ?? 0, issue.destMtimeMs ?? 0)
}
