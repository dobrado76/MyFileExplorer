import { describe, expect, it } from 'vitest'
import {
  buildGitGraph,
  collapseLaneEnds,
  gitForkPath,
  parentRowIndex,
  splitLaneStarts
} from '../shared/gitGraph'
import { parseDecorations } from '../shared/schemas/gitLog'

describe('parseDecorations', () => {
  it('parses HEAD branch, remote, and tag', () => {
    const refs = parseDecorations(
      'HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v0.12.0'
    )
    expect(refs.some((r) => r.kind === 'branch' && r.name === 'main' && r.current)).toBe(true)
    expect(refs.some((r) => r.kind === 'remote' && r.name === 'origin/main')).toBe(true)
    expect(refs.some((r) => r.kind === 'tag' && r.name === 'v0.12.0')).toBe(true)
  })

  it('handles detached HEAD', () => {
    const refs = parseDecorations('HEAD')
    expect(refs).toEqual([{ name: 'HEAD', kind: 'head', current: true }])
  })
})

describe('buildGitGraph', () => {
  it('places a linear history on one lane', () => {
    const rows = buildGitGraph([
      { hash: 'aaa', parents: ['bbb'] },
      { hash: 'bbb', parents: ['ccc'] },
      { hash: 'ccc', parents: [] }
    ])
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.commitLane === 0)).toBe(true)
    expect(rows[0]!.connections[0]?.toLane).toBe(0)
  })

  it('opens a second lane for a merge parent', () => {
    const rows = buildGitGraph([
      { hash: 'merge', parents: ['main', 'feat'] },
      { hash: 'feat', parents: ['base'] },
      { hash: 'main', parents: ['base'] },
      { hash: 'base', parents: [] }
    ])
    expect(rows[0]!.connections.length).toBe(2)
    expect(rows[0]!.connections[0]!.toLane).not.toBe(rows[0]!.connections[1]!.toLane)
  })
})

describe('gitForkPath', () => {
  it('uses vertical tangents (S-curve), not a 90° elbow', () => {
    const d = gitForkPath(10, 14, 24, 42)
    expect(d.startsWith('M 10 14 C 10 ')).toBe(true)
    expect(d.endsWith(', 24 42')).toBe(true)
    expect(d.includes('C 24 14')).toBe(false)
  })

  it('finds the parent row below the child', () => {
    expect(parentRowIndex([{ hash: 'a' }, { hash: 'b' }, { hash: 'c' }], 'c', 0)).toBe(2)
    expect(parentRowIndex([{ hash: 'a' }, { hash: 'b' }], 'z', 0)).toBe(-1)
  })
})

describe('splitLaneStarts', () => {
  it('starts the new lane at the next row center', () => {
    const rows = buildGitGraph([
      { hash: 'merge', parents: ['main', 'feat'] },
      { hash: 'feat', parents: ['base'] },
      { hash: 'main', parents: ['base'] },
      { hash: 'base', parents: [] }
    ])
    const starts = splitLaneStarts(rows)
    expect(starts.has('0:1')).toBe(false)
    expect(starts.has('1:1')).toBe(true)
    expect(starts.has('2:1')).toBe(false)
  })
})

describe('duplicate parent collapse', () => {
  it('connects the side lane instead of ending it beside the same parent', () => {
    const rows = buildGitGraph([
      { hash: 'merge', parents: ['main', 'feat'] },
      { hash: 'feat', parents: ['base'] },
      { hash: 'main', parents: ['base'] },
      { hash: 'base', parents: [] }
    ])

    expect(rows[2]!.outgoing.filter((hash) => hash === 'base')).toHaveLength(1)
    expect(rows[2]!.connections).toContainEqual({
      fromLane: 1,
      toLane: 0,
      parentHash: 'base',
      kind: 'collapse'
    })
    expect(collapseLaneEnds(rows)).toEqual(new Set(['2:1']))
  })
})
