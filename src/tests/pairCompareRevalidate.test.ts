import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { revalidatePlan } from '../main/pairCompare/revalidate'
import type {
  CompareEntrySnapshot,
  PairSyncPlan,
  PairSyncPlanEntry
} from '../shared/pairCompare/types'

describe('paired-folder plan revalidation', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })))
  })

  async function snapshot(
    absolutePath: string,
    relativePath: string
  ): Promise<CompareEntrySnapshot> {
    const stat = await fsp.stat(absolutePath)
    return {
      absolutePath,
      relativePath,
      kind: 'file',
      size: stat.size,
      modifiedMs: stat.mtimeMs
    }
  }

  it('marks a conflict stale when either compared side changes', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-pair-revalidate-'))
    dirs.push(root)
    const leftRoot = path.join(root, 'left')
    const rightRoot = path.join(root, 'right')
    await Promise.all([fsp.mkdir(leftRoot), fsp.mkdir(rightRoot)])
    const leftPath = path.join(leftRoot, 'conflict.txt')
    const rightPath = path.join(rightRoot, 'conflict.txt')
    await Promise.all([
      fsp.writeFile(leftPath, 'left-before'),
      fsp.writeFile(rightPath, 'right-before')
    ])

    const [left, right] = await Promise.all([
      snapshot(leftPath, 'conflict.txt'),
      snapshot(rightPath, 'conflict.txt')
    ])
    const entry: PairSyncPlanEntry = {
      id: 'conflict:conflict.txt',
      action: 'conflict',
      relativePath: 'conflict.txt',
      sourcePath: leftPath,
      destinationPath: rightPath,
      reason: 'different',
      bytes: left.size ?? 0,
      requiredDecision: true,
      rowId: 'conflict.txt'
    }
    const plan: PairSyncPlan = {
      planId: 'plan',
      sessionId: 'session',
      direction: 'two_way',
      policy: 'update',
      scope: 'entire',
      leftRoot,
      rightRoot,
      createdAt: Date.now(),
      incompleteSource: false,
      entries: [entry],
      summary: {
        copy: 0,
        replace: 0,
        createFolder: 0,
        remove: 0,
        conflicts: 1,
        excluded: 0,
        bytes: entry.bytes
      }
    }
    const snapshots = new Map([[entry.rowId, { left, right }]])

    await fsp.writeFile(rightPath, 'right-after-with-a-different-size')

    const result = await revalidatePlan(plan, snapshots)
    expect(result.ok).toBe(false)
    expect(result.staleEntryIds).toContain(entry.id)
  })
})
