import { describe, expect, it } from 'vitest'
import {
  gitBranchCreateRequestSchema,
  gitCommitRefRequestSchema,
  gitCreateTagRequestSchema,
  gitResetRequestSchema
} from '../shared/schemas/git'

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
})
