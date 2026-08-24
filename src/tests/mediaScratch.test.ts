import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  emptyMediaScratchDir,
  emptyMediaScratchDirSync,
  evictOldestMediaScratch,
  MAX_MEDIA_SCRATCH_FILES
} from '../main/media/scratch'

async function writeAged(dir: string, name: string, mtimeMs: number): Promise<string> {
  const filePath = path.join(dir, name)
  await fsp.writeFile(filePath, name)
  const at = new Date(mtimeMs)
  await fsp.utimes(filePath, at, at)
  return filePath
}

describe('media scratch', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-media-scratch-'))
  })

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('exports a session cap of 20', () => {
    expect(MAX_MEDIA_SCRATCH_FILES).toBe(20)
  })

  it('empties the folder and keeps the directory', async () => {
    await fsp.writeFile(path.join(dir, 'a.bin'), 'a')
    await fsp.writeFile(path.join(dir, 'b.bin'), 'b')
    await emptyMediaScratchDir(dir)
    expect(await fsp.readdir(dir)).toEqual([])
  })

  it('empties synchronously for quit', async () => {
    await fsp.writeFile(path.join(dir, 'a.bin'), 'a')
    emptyMediaScratchDirSync(dir)
    expect(await fsp.readdir(dir)).toEqual([])
  })

  it('deletes oldest first when reserving a new slot', async () => {
    const t0 = Date.UTC(2026, 0, 1)
    await writeAged(dir, 'old.bin', t0)
    await writeAged(dir, 'mid.bin', t0 + 60_000)
    await writeAged(dir, 'new.bin', t0 + 120_000)
    const incoming = path.join(dir, 'incoming.bin')
    await evictOldestMediaScratch(dir, { keepPath: incoming, max: 3 })
    const left = (await fsp.readdir(dir)).sort()
    expect(left).toEqual(['mid.bin', 'new.bin'])
  })

  it('never deletes the keep path even when it is oldest', async () => {
    const t0 = Date.UTC(2026, 0, 1)
    const keep = await writeAged(dir, 'keep.bin', t0)
    await writeAged(dir, 'newer.bin', t0 + 60_000)
    await evictOldestMediaScratch(dir, { keepPath: keep, max: 1 })
    const left = await fsp.readdir(dir)
    expect(left).toEqual(['keep.bin'])
  })

  it('ignores .tmp leftovers when counting the cap', async () => {
    const t0 = Date.UTC(2026, 0, 1)
    await writeAged(dir, 'a.bin', t0)
    await fsp.writeFile(path.join(dir, 'partial.bin.tmp'), 'tmp')
    await evictOldestMediaScratch(dir, { keepPath: path.join(dir, 'b.bin'), max: 2 })
    const left = (await fsp.readdir(dir)).sort()
    expect(left).toEqual(['a.bin', 'partial.bin.tmp'])
  })
})
