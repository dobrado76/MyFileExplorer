import { describe, expect, it } from 'vitest'
import {
  buildFolderAggregates,
  parsePorcelainV2,
  summarizePaths
} from '../main/git/statusParse'
import { primaryGitState, gitStatusLabel } from '../shared/schemas/git'

function zJoin(parts: string[]): string {
  return parts.join('\0') + '\0'
}

describe('parsePorcelainV2', () => {
  it('parses clean branch header', () => {
    const raw = zJoin([
      '# branch.oid abc',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +0 -0'
    ])
    const p = parsePorcelainV2(raw)
    expect(p.branch).toBe('main')
    expect(p.detachedHead).toBe(false)
    expect(p.ahead).toBe(0)
    expect(p.behind).toBe(0)
    expect(p.paths).toHaveLength(0)
  })

  it('parses detached head', () => {
    const p = parsePorcelainV2(zJoin(['# branch.head (detached)', '# branch.oid deadbeef']))
    expect(p.detachedHead).toBe(true)
    expect(p.branch).toBeNull()
  })

  it('parses staged and unstaged modified', () => {
    // 1 XY sub mH mI mW hH hI path
    const line = '1 MM N... 100644 100644 100644 abc def src/a.ts'
    const p = parsePorcelainV2(zJoin(['# branch.head main', line]))
    expect(p.paths).toHaveLength(1)
    expect(p.paths[0]!.relativePath).toBe('src/a.ts')
    expect(p.paths[0]!.staged).toBe('modified')
    expect(p.paths[0]!.workingTree).toBe('modified')
  })

  it('parses added / deleted', () => {
    const p = parsePorcelainV2(
      zJoin([
        '1 A. N... 000000 100644 100644 000 newhash new.ts',
        '1 .D N... 100644 100644 000000 oldhash 000 gone.ts'
      ])
    )
    expect(p.paths[0]!.staged).toBe('added')
    expect(p.paths[0]!.workingTree).toBeNull()
    expect(p.paths[1]!.staged).toBeNull()
    expect(p.paths[1]!.workingTree).toBe('deleted')
  })

  it('parses rename with original path', () => {
    const raw =
      '2 R. N... 100644 100644 100644 aaa bbb R100 new name.ts\0old name.ts\0'
    const p = parsePorcelainV2(raw)
    expect(p.paths[0]!.relativePath).toBe('new name.ts')
    expect(p.paths[0]!.originalPath).toBe('old name.ts')
    expect(p.paths[0]!.staged).toBe('renamed')
  })

  it('parses untracked and ignored', () => {
    const p = parsePorcelainV2(zJoin(['? scratch.tmp', '! build/out.bin']))
    expect(p.paths[0]!.workingTree).toBe('untracked')
    expect(p.paths[1]!.workingTree).toBe('ignored')
  })

  it('parses conflict', () => {
    const line = 'u UU N... 100644 100644 100644 100644 a b c d conflict.ts'
    const p = parsePorcelainV2(zJoin([line]))
    expect(p.paths[0]!.conflicted).toBe(true)
    expect(primaryGitState(p.paths[0]!)).toBe('conflicted')
  })

  it('handles spaces and unicode paths', () => {
    const line = '1 .M N... 100644 100644 100644 aaa bbb docs/你好 world.md'
    const p = parsePorcelainV2(zJoin([line]))
    expect(p.paths[0]!.relativePath).toBe('docs/你好 world.md')
  })

  it('builds folder aggregates', () => {
    const paths = parsePorcelainV2(
      zJoin([
        '1 .M N... 100644 100644 100644 a b src/foo/bar.ts',
        '? src/foo/new.ts'
      ])
    ).paths
    const folders = buildFolderAggregates(paths)
    expect(folders['src']?.containsModified).toBe(true)
    expect(folders['src/foo']?.containsUntracked).toBe(true)
  })

  it('summarizes counts', () => {
    const paths = parsePorcelainV2(
      zJoin([
        '1 A. N... 000000 100644 100644 0 a staged.ts',
        '? untracked.ts',
        'u UU N... 100644 100644 100644 100644 a b c d c.ts'
      ])
    ).paths
    const s = summarizePaths(paths)
    expect(s.stagedCount).toBeGreaterThanOrEqual(1)
    expect(s.untrackedCount).toBe(1)
    expect(s.conflictCount).toBe(1)
  })

  it('labels combined staged+unstaged', () => {
    const row = {
      relativePath: 'x',
      staged: 'modified' as const,
      workingTree: 'modified' as const,
      conflicted: false
    }
    expect(gitStatusLabel(row)).toBe('Modified + Staged')
  })
})
