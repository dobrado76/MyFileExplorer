import { describe, expect, it } from 'vitest'
import { isGitMissingRepoMessage } from '../shared/gitErrors'

describe('isGitMissingRepoMessage', () => {
  it('matches the usual fatal line', () => {
    expect(
      isGitMissingRepoMessage(
        'fatal: not a git repository (or any of the parent directories): .git'
      )
    ).toBe(true)
  })

  it('ignores unrelated Git errors', () => {
    expect(isGitMissingRepoMessage('fatal: Authentication failed')).toBe(false)
    expect(isGitMissingRepoMessage('')).toBe(false)
  })
})
