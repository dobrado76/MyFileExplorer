import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '../shared/result'
import { resolveIssuesRequestSchema } from '../shared/schemas/fs'
import { renameEntry, uniqueTargetName } from '../main/fs/ops'

describe('rename name clashes', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
  })

  async function tempDir(): Promise<string> {
    const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-rename-clash-'))
    dirs.push(d)
    return d
  }

  it('Keep both uses the same name (2) formula as copy/move', async () => {
    const dir = await tempDir()
    await fsp.writeFile(path.join(dir, 'clip.avi'), 'a')
    await expect(uniqueTargetName(dir, 'clip.avi')).resolves.toBe('clip (2).avi')
    await fsp.writeFile(path.join(dir, 'clip (2).avi'), 'b')
    await expect(uniqueTargetName(dir, 'clip.avi')).resolves.toBe('clip (3).avi')
  })

  it('default rename fails when the new name exists', async () => {
    const dir = await tempDir()
    const from = path.join(dir, 'old.txt')
    await fsp.writeFile(from, 'src')
    await fsp.writeFile(path.join(dir, 'taken.txt'), 'dst')
    await expect(renameEntry(from, 'taken.txt')).rejects.toMatchObject({
      code: 'conflict'
    })
    await expect(fsp.readFile(from, 'utf8')).resolves.toBe('src')
  })

  it('conflictPolicy rename keeps both as name (2)', async () => {
    const dir = await tempDir()
    const from = path.join(dir, 'old.txt')
    await fsp.writeFile(from, 'src')
    await fsp.writeFile(path.join(dir, 'taken.txt'), 'dst')
    const res = await renameEntry(from, 'taken.txt', 'rename')
    expect(path.basename(res.path)).toBe('taken (2).txt')
    await expect(fsp.readFile(res.path, 'utf8')).resolves.toBe('src')
    await expect(fsp.readFile(path.join(dir, 'taken.txt'), 'utf8')).resolves.toBe('dst')
  })

  it('conflictPolicy replace overwrites the existing name', async () => {
    const dir = await tempDir()
    const from = path.join(dir, 'old.txt')
    const dest = path.join(dir, 'taken.txt')
    await fsp.writeFile(from, 'src')
    await fsp.writeFile(dest, 'dst')
    const res = await renameEntry(from, 'taken.txt', 'replace')
    expect(res.path).toBe(dest)
    await expect(fsp.readFile(dest, 'utf8')).resolves.toBe('src')
    await expect(fsp.access(from)).rejects.toBeTruthy()
  })

  it('accepts rename in fs:resolveIssues', () => {
    const parsed = resolveIssuesRequestSchema.parse({
      op: 'rename',
      destinationDir: 'C:\\lib',
      items: [{ source: 'C:\\lib\\a.avi', dest: 'C:\\lib\\b.avi', decision: 'rename' }]
    })
    expect(parsed.op).toBe('rename')
    expect(parsed.items[0]!.decision).toBe('rename')
  })

  it('AppError conflict stays the review kind', () => {
    const e = new AppError('conflict', '"taken.txt" already exists', 'Choose a different name.')
    expect(e.code).toBe('conflict')
  })
})
