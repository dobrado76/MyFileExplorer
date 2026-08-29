import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppError } from '../shared/result'
import { toRepoRelativePaths } from '../main/git/paths'

describe.skipIf(process.platform !== 'win32')('toRepoRelativePaths', () => {
  const root = 'C:\\repos\\demo'

  it('converts absolute paths under root', () => {
    const rels = toRepoRelativePaths(root, [
      'C:\\repos\\demo\\src\\a.ts',
      'C:\\repos\\demo\\readme.md'
    ])
    expect(rels).toEqual(['src/a.ts', 'readme.md'])
  })

  it('rejects paths outside the repository', () => {
    expect(() => toRepoRelativePaths(root, ['C:\\other\\file.ts'])).toThrow(AppError)
  })

  it('rejects relative inputs', () => {
    expect(() => toRepoRelativePaths(root, ['src/a.ts'])).toThrow(AppError)
  })

  it('normalizes separators', () => {
    const rels = toRepoRelativePaths(root, [path.join(root, 'a', 'b.txt')])
    expect(rels[0]).toBe('a/b.txt')
  })
})
