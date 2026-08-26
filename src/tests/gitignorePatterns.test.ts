import { describe, expect, it } from 'vitest'
import {
  appendGitignorePatterns,
  gitignoreAlreadyHas,
  gitignorePatternForRelative
} from '../shared/gitignorePatterns'

describe('gitignorePatterns', () => {
  it('builds file and folder patterns', () => {
    expect(gitignorePatternForRelative('src/foo.ts', false)).toBe('src/foo.ts')
    expect(gitignorePatternForRelative('build', true)).toBe('build/')
    expect(gitignorePatternForRelative('build/', true)).toBe('build/')
    expect(gitignorePatternForRelative('.gitignore', false)).toBeNull()
    expect(gitignorePatternForRelative('.git', true)).toBeNull()
    expect(gitignorePatternForRelative('', false)).toBeNull()
  })

  it('detects existing patterns', () => {
    const body = 'node_modules/\n# comment\ndist\n'
    expect(gitignoreAlreadyHas(body, 'node_modules/')).toBe(true)
    expect(gitignoreAlreadyHas(body, 'node_modules')).toBe(true)
    expect(gitignoreAlreadyHas(body, 'dist/')).toBe(true)
    expect(gitignoreAlreadyHas(body, 'src/')).toBe(false)
  })

  it('appends only new patterns with a trailing newline', () => {
    expect(appendGitignorePatterns('', ['a.txt', 'b/'])).toBe('a.txt\nb/\n')
    expect(appendGitignorePatterns('a.txt\n', ['a.txt', 'c.txt'])).toBe('a.txt\nc.txt\n')
  })
})
