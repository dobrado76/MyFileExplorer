import { describe, expect, it } from 'vitest'
import {
  gitBranchCreateRequestSchema,
  gitCommitRefRequestSchema,
  gitCreateTagRequestSchema,
  gitDeleteTagRequestSchema,
  gitDiffRequestSchema,
  gitResetRequestSchema,
  gitSettingsSchema
} from '../shared/schemas/git'
import {
  gitFileLogRequestSchema,
  gitShowCommitRequestSchema
} from '../shared/schemas/gitLog'

describe('git history op schemas', () => {
  it('accepts createBranch with optional startPoint', () => {
    const parsed = gitBranchCreateRequestSchema.parse({
      repoRoot: 'C:/repo',
      branch: 'feature/x',
      switchTo: true,
      startPoint: 'abc1234'
    })
    expect(parsed.startPoint).toBe('abc1234')
  })

  it('accepts createTag / commit ref / reset', () => {
    expect(
      gitCreateTagRequestSchema.parse({
        repoRoot: 'C:/repo',
        tag: 'v1.0.0',
        commit: 'abcdef0'
      }).tag
    ).toBe('v1.0.0')
    expect(
      gitCreateTagRequestSchema.parse({
        repoRoot: 'C:/repo',
        tag: 'v1.0.0',
        commit: 'abcdef0',
        pushToRemote: true,
        remote: 'origin',
        forceRemote: true
      }).forceRemote
    ).toBe(true)
    expect(
      gitDeleteTagRequestSchema.parse({
        repoRoot: 'C:/repo',
        tag: 'v1.0.0',
        deleteRemote: true
      }).deleteRemote
    ).toBe(true)
    expect(
      gitCommitRefRequestSchema.parse({ repoRoot: 'C:/repo', commit: 'abcdef012345' }).commit
    ).toBe('abcdef012345')
    expect(
      gitResetRequestSchema.parse({
        repoRoot: 'C:/repo',
        commit: 'abcdef0',
        mode: 'hard'
      }).mode
    ).toBe('hard')
  })

  it('rejects invalid reset mode', () => {
    expect(() =>
      gitResetRequestSchema.parse({
        repoRoot: 'C:/repo',
        commit: 'abcdef0',
        mode: 'nuke'
      })
    ).toThrow()
  })

  it('accepts showDiff with optional commit refs', () => {
    const parsed = gitDiffRequestSchema.parse({
      repoRoot: 'C:/repo',
      path: 'C:/repo/src/foo.ts',
      commit: 'abcdef0',
      otherCommit: '1234567'
    })
    expect(parsed.otherCommit).toBe('1234567')
  })

  it('accepts showCommit and logFile requests', () => {
    expect(
      gitShowCommitRequestSchema.parse({ repoRoot: 'C:/repo', commit: 'abcdef0' }).commit
    ).toBe('abcdef0')
    expect(
      gitFileLogRequestSchema.parse({
        repoRoot: 'C:/repo',
        path: 'C:/repo/README.md',
        limit: 50
      }).limit
    ).toBe(50)
  })

  it('defaults git historyPageSize', () => {
    expect(gitSettingsSchema.parse({}).historyPageSize).toBe(150)
    expect(gitSettingsSchema.parse({ historyPageSize: 500 }).historyPageSize).toBe(500)
  })
})
