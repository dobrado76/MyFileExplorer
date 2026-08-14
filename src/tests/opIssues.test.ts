import { describe, expect, it } from 'vitest'
import {
  actionsForKind,
  applyKeepNewer,
  classifyOpIssue,
  groupOpIssues,
  issueKey,
  resolveIssueDecision,
  shouldQueueNameConflict,
  type OpIssue
} from '../shared/opIssues'

function issue(partial: Partial<OpIssue> & Pick<OpIssue, 'kind' | 'source'>): OpIssue {
  return {
    code: 'io',
    message: 'failed',
    ...partial
  }
}

describe('classifyOpIssue', () => {
  it('maps name clashes and common Win32/Node failures', () => {
    expect(classifyOpIssue('conflict')).toBe('name_conflict')
    expect(classifyOpIssue('busy', 'EBUSY')).toBe('busy')
    expect(classifyOpIssue('not-allowed', 'EACCES')).toBe('not_allowed')
    expect(classifyOpIssue('not-found', 'ENOENT')).toBe('not_found')
    expect(classifyOpIssue('io', 'ENAMETOOLONG')).toBe('path_too_long')
    expect(classifyOpIssue('io', 'ENOSPC')).toBe('fatal')
    expect(classifyOpIssue('io', 'EDQUOT')).toBe('fatal')
    expect(classifyOpIssue('io', 'EROFS')).toBe('fatal')
    expect(classifyOpIssue('cancelled')).toBe('fatal')
    expect(classifyOpIssue('io', 'EIO')).toBe('io')
  })
})

describe('applyKeepNewer', () => {
  it('replaces when the source is newer', () => {
    expect(applyKeepNewer(200, 100)).toBe('replace')
  })

  it('skips when the destination is newer', () => {
    expect(applyKeepNewer(100, 200)).toBe('skip')
  })

  it('keeps both when mtimes are equal', () => {
    expect(applyKeepNewer(100, 100)).toBe('rename')
  })

  it('resolveIssueDecision expands keep_newer', () => {
    expect(resolveIssueDecision('keep_newer', { sourceMtimeMs: 9, destMtimeMs: 3 })).toBe(
      'replace'
    )
    expect(resolveIssueDecision('skip', { sourceMtimeMs: 9, destMtimeMs: 3 })).toBe('skip')
  })
})

describe('shouldQueueNameConflict', () => {
  it('queues only under the default fail policy so the first pass can continue', () => {
    expect(shouldQueueNameConflict('fail', true)).toBe(true)
    expect(shouldQueueNameConflict('replace', true)).toBe(false)
    expect(shouldQueueNameConflict('rename', true)).toBe(false)
    expect(shouldQueueNameConflict('skip', true)).toBe(false)
    expect(shouldQueueNameConflict('fail', false)).toBe(false)
  })
})

describe('groupOpIssues', () => {
  it('groups similar kinds in stable order with counts', () => {
    const issues = [
      issue({ kind: 'busy', source: 'C:\\a\\locked.txt' }),
      issue({ kind: 'name_conflict', source: 'C:\\a\\dup.txt', dest: 'D:\\dup.txt' }),
      issue({ kind: 'name_conflict', source: 'C:\\a\\dup2.txt', dest: 'D:\\dup2.txt' }),
      issue({ kind: 'not_allowed', source: 'C:\\a\\secret.txt' })
    ]
    const groups = groupOpIssues(issues)
    expect(groups.map((g) => [g.kind, g.items.length])).toEqual([
      ['name_conflict', 2],
      ['busy', 1],
      ['not_allowed', 1]
    ])
    expect(issueKey(issues[1]!)).not.toBe(issueKey(issues[2]!))
  })

  it('offers apply-to-similar actions including keep most recent on name conflicts', () => {
    expect(actionsForKind('name_conflict').map((a) => a.decision)).toEqual([
      'skip',
      'rename',
      'replace',
      'keep_newer'
    ])
    expect(actionsForKind('busy').map((a) => a.decision)).toEqual(['retry', 'skip'])
    expect(actionsForKind('not_found').map((a) => a.decision)).toEqual(['skip'])
    expect(actionsForKind('path_too_long').map((a) => a.decision)).toEqual(['skip'])
  })
})
