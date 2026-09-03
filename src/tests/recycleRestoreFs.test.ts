import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { restoreViaFilesystem } from '../main/fs/recycle'

const temps: string[] = []

afterEach(async () => {
  for (const t of temps.splice(0)) {
    await fsp.rm(t, { recursive: true, force: true }).catch(() => {})
  }
})

describe('restoreViaFilesystem', () => {
  it('moves $R data back to the original path and deletes $I metadata', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-rb-fs-'))
    temps.push(root)
    const sid = path.join(root, '$Recycle.Bin', 'S-1-5-test')
    const destDir = path.join(root, 'Documents')
    await fsp.mkdir(sid, { recursive: true })
    await fsp.mkdir(destDir, { recursive: true })

    const recyclePath = path.join(sid, '$RABC.txt')
    const metaPath = path.join(sid, '$IABC.txt')
    const originalPath = path.join(destDir, 'notes.txt')
    await fsp.writeFile(recyclePath, 'hello-restore', 'utf8')
    await fsp.writeFile(metaPath, 'meta', 'utf8')

    const ok = await restoreViaFilesystem({
      recyclePath,
      originalPath,
      dateDeletedMs: Date.now()
    })
    expect(ok).toBe(true)
    expect(await fsp.readFile(originalPath, 'utf8')).toBe('hello-restore')
    await expect(fsp.access(recyclePath)).rejects.toThrow()
    await expect(fsp.access(metaPath)).rejects.toThrow()
  })

  it('refuses when the original path already exists', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-rb-fs2-'))
    temps.push(root)
    const sid = path.join(root, '$Recycle.Bin', 'S-1-5-test')
    await fsp.mkdir(sid, { recursive: true })
    const recyclePath = path.join(sid, '$R1.txt')
    const originalPath = path.join(root, 'exists.txt')
    await fsp.writeFile(recyclePath, 'x', 'utf8')
    await fsp.writeFile(originalPath, 'y', 'utf8')

    expect(
      await restoreViaFilesystem({
        recyclePath,
        originalPath,
        dateDeletedMs: 1
      })
    ).toBe(false)
    expect(await fsp.readFile(originalPath, 'utf8')).toBe('y')
  })
})
