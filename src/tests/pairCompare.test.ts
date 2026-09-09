import { describe, expect, it } from 'vitest'
import { classifyPair, buildRow } from '../shared/pairCompare/classify'
import { computePairActionAvailability } from '../shared/pairCompare/availability'
import { buildSyncPlan } from '../shared/pairCompare/plan'
import { isPathUnder, normalizeRelativePath } from '../shared/pairCompare/pathUtils'
import type {
  CompareEntrySnapshot,
  PairCompareRow,
  PairSyncPlan,
  PairSyncPlanEntry
} from '../shared/pairCompare/types'
import { resolveConflictTransfer } from '../main/pairCompare/conflictResolve'

function file(
  side: 'L' | 'R',
  rel: string,
  size: number,
  mtime: number
): CompareEntrySnapshot {
  return {
    absolutePath: `${side}:\\root\\${rel.replace(/\//g, '\\')}`,
    relativePath: rel,
    kind: 'file',
    size,
    modifiedMs: mtime
  }
}

describe('pairCompare pathUtils', () => {
  it('normalizes relative paths', () => {
    expect(normalizeRelativePath('a\\b\\c', false)).toBe('a/b/c')
    expect(normalizeRelativePath('A/B', false)).toBe('a/b')
    expect(normalizeRelativePath('A/B', true)).toBe('A/B')
  })

  it('detects nested roots', () => {
    expect(isPathUnder('C:\\Photos', 'C:\\Photos\\Backup', false)).toBe(true)
    expect(isPathUnder('C:\\Photos', 'C:\\Other', false)).toBe(false)
  })
})

describe('classifyPair', () => {
  const opts = { compareMethod: 'size_mtime' as const, modifiedToleranceMs: 2000 }

  it('classifies left_only / right_only', () => {
    expect(classifyPair(file('L', 'a.txt', 10, 1000), null, opts).status).toBe('left_only')
    expect(classifyPair(null, file('R', 'a.txt', 10, 1000), opts).status).toBe('right_only')
  })

  it('classifies identical within tolerance', () => {
    const a = file('L', 'a.txt', 100, 1000)
    const b = file('R', 'a.txt', 100, 2500)
    expect(classifyPair(a, b, opts).status).toBe('identical')
  })

  it('classifies left_newer', () => {
    const a = file('L', 'a.txt', 100, 10_000)
    const b = file('R', 'a.txt', 100, 1000)
    expect(classifyPair(a, b, opts).status).toBe('left_newer')
  })

  it('classifies different size with equal time as different', () => {
    const a = file('L', 'a.txt', 100, 1000)
    const b = file('R', 'a.txt', 200, 1000)
    expect(classifyPair(a, b, opts).status).toBe('different')
  })

  it('classifies type_conflict', () => {
    const a: CompareEntrySnapshot = { ...file('L', 'x', 0, 1), kind: 'file' }
    const b: CompareEntrySnapshot = {
      absolutePath: 'R:\\root\\x',
      relativePath: 'x',
      kind: 'directory',
      size: null,
      modifiedMs: 1
    }
    expect(classifyPair(a, b, opts).status).toBe('type_conflict')
  })

  it('size-only method', () => {
    const a = file('L', 'a.txt', 100, 1)
    const b = file('R', 'a.txt', 100, 999999)
    expect(
      classifyPair(a, b, { compareMethod: 'size', modifiedToleranceMs: 0 }).status
    ).toBe('identical')
  })
})

describe('computePairActionAvailability', () => {
  it('requires layout 2', () => {
    const a = computePairActionAvailability({
      viewLayout: 1,
      left: { hasTab: true, path: 'C:\\A', searchActive: false, recycleActive: false },
      right: { hasTab: true, path: 'C:\\B', searchActive: false, recycleActive: false }
    })
    expect(a.railVisible).toBe(false)
  })

  it('enables compare for two local folders', () => {
    const a = computePairActionAvailability({
      viewLayout: 2,
      left: { hasTab: true, path: 'C:\\A', searchActive: false, recycleActive: false },
      right: { hasTab: true, path: 'D:\\B', searchActive: false, recycleActive: false }
    })
    expect(a.canCompare).toBe(true)
    expect(a.canSync).toBe(true)
    expect(a.canCopyLeftToRight).toBe(true)
  })

  it('blocks nested roots', () => {
    const a = computePairActionAvailability({
      viewLayout: 2,
      left: { hasTab: true, path: 'C:\\Photos', searchActive: false, recycleActive: false },
      right: {
        hasTab: true,
        path: 'C:\\Photos\\Backup',
        searchActive: false,
        recycleActive: false
      }
    })
    expect(a.nestedRoots).toBe(true)
    expect(a.canSync).toBe(false)
  })

  it('blocks same root for directional ops', () => {
    const a = computePairActionAvailability({
      viewLayout: 2,
      left: { hasTab: true, path: 'C:\\A', searchActive: false, recycleActive: false },
      right: { hasTab: true, path: 'C:\\A\\', searchActive: false, recycleActive: false }
    })
    expect(a.sameRoot).toBe(true)
    expect(a.canCopyLeftToRight).toBe(false)
  })
})

describe('buildSyncPlan', () => {
  const rows: PairCompareRow[] = [
    buildRow('onlyL.txt', file('L', 'onlyL.txt', 1, 1), null, {
      compareMethod: 'size_mtime',
      modifiedToleranceMs: 2000,
      caseSensitive: false
    }),
    buildRow('onlyR.txt', null, file('R', 'onlyR.txt', 1, 1), {
      compareMethod: 'size_mtime',
      modifiedToleranceMs: 2000,
      caseSensitive: false
    }),
    buildRow('newerL.txt', file('L', 'newerL.txt', 5, 9000), file('R', 'newerL.txt', 5, 1000), {
      compareMethod: 'size_mtime',
      modifiedToleranceMs: 2000,
      caseSensitive: false
    })
  ]

  it('update left→right copies missing and newer', () => {
    const plan = buildSyncPlan({
      sessionId: 's',
      planId: 'p',
      direction: 'left_to_right',
      policy: 'update',
      scope: 'entire',
      leftRoot: 'C:\\L',
      rightRoot: 'D:\\R',
      rows,
      incompleteSource: false
    })
    expect(plan.summary.copy).toBeGreaterThanOrEqual(1)
    expect(plan.summary.replace).toBeGreaterThanOrEqual(1)
    expect(plan.summary.remove).toBe(0)
  })

  it('two-way never deletes', () => {
    const plan = buildSyncPlan({
      sessionId: 's',
      planId: 'p',
      direction: 'two_way',
      policy: 'update',
      scope: 'entire',
      leftRoot: 'C:\\L',
      rightRoot: 'D:\\R',
      rows,
      incompleteSource: false
    })
    expect(plan.entries.every((e) => e.action !== 'trash')).toBe(true)
  })

  it('mirror proposes destination-only removal', () => {
    const plan = buildSyncPlan({
      sessionId: 's',
      planId: 'p',
      direction: 'left_to_right',
      policy: 'mirror',
      scope: 'entire',
      leftRoot: 'C:\\L',
      rightRoot: 'D:\\R',
      rows,
      incompleteSource: false
    })
    expect(plan.summary.remove).toBeGreaterThanOrEqual(1)
  })

  it('incomplete scan yields empty mirror plan', () => {
    const plan = buildSyncPlan({
      sessionId: 's',
      planId: 'p',
      direction: 'left_to_right',
      policy: 'mirror',
      scope: 'entire',
      leftRoot: 'C:\\L',
      rightRoot: 'D:\\R',
      rows,
      incompleteSource: true
    })
    expect(plan.entries).toHaveLength(0)
  })
})

describe('resolveConflictTransfer', () => {
  const plan: PairSyncPlan = {
    planId: 'p',
    sessionId: 's',
    direction: 'two_way',
    policy: 'update',
    scope: 'entire',
    leftRoot: 'C:\\L',
    rightRoot: 'D:\\R',
    createdAt: 0,
    incompleteSource: false,
    entries: [],
    summary: {
      copy: 0,
      replace: 0,
      createFolder: 0,
      remove: 0,
      conflicts: 0,
      excluded: 0,
      bytes: 0
    }
  }
  const entry: PairSyncPlanEntry = {
    id: 'conflict:a.txt',
    action: 'conflict',
    relativePath: 'a.txt',
    sourcePath: 'C:\\L\\a.txt',
    destinationPath: 'D:\\R\\a.txt',
    reason: 'conflict',
    bytes: 1,
    requiredDecision: true,
    rowId: 'a.txt'
  }

  it('use_left copies left → right with replace', () => {
    const r = resolveConflictTransfer(plan, entry, 'use_left')
    expect(r).toEqual({
      kind: 'copy',
      source: 'C:\\L\\a.txt',
      dest: 'D:\\R\\a.txt',
      policy: 'replace',
      countAs: 'replaced'
    })
  })

  it('use_right copies right → left with replace (reverses direction)', () => {
    const r = resolveConflictTransfer(plan, entry, 'use_right')
    expect(r).toEqual({
      kind: 'copy',
      source: 'D:\\R\\a.txt',
      dest: 'C:\\L\\a.txt',
      policy: 'replace',
      countAs: 'replaced'
    })
  })

  it('keep_both uses rename policy', () => {
    const r = resolveConflictTransfer(plan, entry, 'keep_both')
    expect(r.kind).toBe('copy')
    if (r.kind === 'copy') {
      expect(r.policy).toBe('rename')
      expect(r.source).toBe('C:\\L\\a.txt')
      expect(r.dest).toBe('D:\\R\\a.txt')
    }
  })

  it('keep_recent picks the newer side (not always rename)', () => {
    const leftWins = resolveConflictTransfer(plan, entry, 'keep_recent', {
      leftMtimeMs: 200,
      rightMtimeMs: 100
    })
    expect(leftWins).toMatchObject({
      kind: 'copy',
      source: 'C:\\L\\a.txt',
      dest: 'D:\\R\\a.txt',
      policy: 'replace'
    })
    const rightWins = resolveConflictTransfer(plan, entry, 'keep_recent', {
      leftMtimeMs: 100,
      rightMtimeMs: 200
    })
    expect(rightWins).toMatchObject({
      kind: 'copy',
      source: 'D:\\R\\a.txt',
      dest: 'C:\\L\\a.txt',
      policy: 'replace'
    })
    const equal = resolveConflictTransfer(plan, entry, 'keep_recent', {
      leftMtimeMs: 100,
      rightMtimeMs: 100
    })
    expect(equal).toMatchObject({ kind: 'copy', policy: 'rename' })
  })
})
