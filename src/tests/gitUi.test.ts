import { describe, expect, it } from 'vitest'
import type { GitRepositoryStatus } from '../shared/schemas/git'
import { lookupGitForPath, toRepoRelative } from '../renderer/lib/gitUi'

function status(rootPath: string): GitRepositoryStatus {
  return {
    info: {
      rootPath,
      gitDir: `${rootPath}/.git`,
      branch: 'main',
      detachedHead: false,
      lastStatusRefresh: 1
    },
    paths: [
      {
        relativePath: 'src/main.ts',
        staged: null,
        workingTree: 'modified',
        conflicted: false
      }
    ],
    folders: {
      src: {
        containsModified: true,
        containsStaged: false,
        containsUntracked: false,
        containsConflict: false
      }
    },
    changedCount: 1,
    conflictCount: 0,
    stagedCount: 0,
    untrackedCount: 0
  }
}

describe('renderer Git path lookup', () => {
  it('handles POSIX repository paths and finds a child project from its parent', () => {
    const root = '/home/user/projects/demo'
    const child = `${root}/src/main.ts`
    const repo = status(root)

    expect(toRepoRelative(root, child)).toBe('src/main.ts')
    expect(lookupGitForPath({ [root]: repo }, child)?.rootPath).toBe(root)
    expect(lookupGitForPath({ [root]: repo }, child)?.pathRow?.workingTree).toBe('modified')
  })

  it('does not match a sibling POSIX path', () => {
    const root = '/home/user/projects/demo'
    expect(toRepoRelative(root, '/home/user/projects/demolition/file.ts')).toBeNull()
    expect(lookupGitForPath({ [root]: status(root) }, '/home/user/projects/demolition')).toBeNull()
  })
})
