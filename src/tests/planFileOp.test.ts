import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { planFileOp } from '../main/fs/ops'

describe('planFileOp', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
  })

  async function tempDir(): Promise<string> {
    const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-plan-op-'))
    dirs.push(d)
    return d
  }

  it('same-folder copy plans Keep both rename, not skip', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'tsconfig.node.json')
    await fsp.writeFile(file, '{}\n')

    const plan = await planFileOp({
      op: 'copy',
      sources: [file],
      destinationDir: dir
    })

    expect(plan.conflictPolicy).toBe('rename')
    expect(plan.totals.skips).toBe(0)
    expect(plan.rows).toHaveLength(1)
    expect(plan.rows[0]?.status).toBe('ok')
    expect(plan.rows[0]?.dest).toBe(path.join(dir, 'tsconfig.node (2).json'))
    expect(plan.totals.files).toBe(1)
  })

  it('same-folder copy with fail policy reports skip', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'a.txt')
    await fsp.writeFile(file, 'x')

    const plan = await planFileOp({
      op: 'copy',
      sources: [file],
      destinationDir: dir,
      conflictPolicy: 'fail'
    })

    expect(plan.conflictPolicy).toBe('fail')
    expect(plan.rows[0]?.status).toBe('skip')
  })
})
