import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyEntries, moveEntries } from '../main/fs/ops'

describe('copy/move Replace merges folders (Explorer parity)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
  })

  async function tempDir(): Promise<string> {
    const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-folder-merge-'))
    dirs.push(d)
    return d
  }

  it('copy Replace merges into the existing folder and keeps dest-only files', async () => {
    const root = await tempDir()
    const destParent = path.join(root, 'dest')
    const srcParent = path.join(root, 'src')
    await fsp.mkdir(destParent)
    await fsp.mkdir(srcParent)
    const existing = path.join(destParent, 'Show')
    const incoming = path.join(srcParent, 'Show')
    await fsp.mkdir(existing)
    await fsp.mkdir(incoming)
    await fsp.writeFile(path.join(existing, 'kept.txt'), 'dest')
    await fsp.writeFile(path.join(incoming, 'added.txt'), 'src')
    await fsp.writeFile(path.join(incoming, 'kept.txt'), 'overwritten')

    const res = await copyEntries([incoming], destParent, 'replace')
    expect(res.issues).toEqual([])
    expect(res.copied).toEqual([existing])
    await expect(fsp.readFile(path.join(existing, 'kept.txt'), 'utf8')).resolves.toBe('overwritten')
    await expect(fsp.readFile(path.join(existing, 'added.txt'), 'utf8')).resolves.toBe('src')
    // Source still exists after copy
    await expect(fsp.access(incoming)).resolves.toBeUndefined()
  })

  it('move Replace merges into the existing folder without deleting it first', async () => {
    const root = await tempDir()
    const destParent = path.join(root, 'dest')
    const srcParent = path.join(root, 'src')
    await fsp.mkdir(destParent)
    await fsp.mkdir(srcParent)
    const existing = path.join(destParent, 'Show')
    const incoming = path.join(srcParent, 'Show')
    await fsp.mkdir(existing)
    await fsp.mkdir(incoming)
    await fsp.writeFile(path.join(existing, 'kept.txt'), 'dest')
    await fsp.writeFile(path.join(incoming, 'added.txt'), 'src')

    const res = await moveEntries([incoming], destParent, 'replace')
    expect(res.issues).toEqual([])
    expect(res.moved).toEqual([existing])
    await expect(fsp.readFile(path.join(existing, 'kept.txt'), 'utf8')).resolves.toBe('dest')
    await expect(fsp.readFile(path.join(existing, 'added.txt'), 'utf8')).resolves.toBe('src')
    await expect(fsp.access(incoming)).rejects.toBeTruthy()
  })

  it('copy Replace still overwrites a conflicting file (not a folder)', async () => {
    const root = await tempDir()
    const destParent = path.join(root, 'dest')
    const srcParent = path.join(root, 'src')
    await fsp.mkdir(destParent)
    await fsp.mkdir(srcParent)
    await fsp.writeFile(path.join(destParent, 'clip.txt'), 'old')
    await fsp.writeFile(path.join(srcParent, 'clip.txt'), 'new')
    const res = await copyEntries([path.join(srcParent, 'clip.txt')], destParent, 'replace')
    expect(res.issues).toEqual([])
    await expect(fsp.readFile(path.join(destParent, 'clip.txt'), 'utf8')).resolves.toBe('new')
  })

  it.runIf(process.platform === 'win32')(
    'copy Replace preserves ADS on the existing destination folder',
    async () => {
      const root = await tempDir()
      const destParent = path.join(root, 'dest')
      const srcParent = path.join(root, 'src')
      await fsp.mkdir(destParent)
      await fsp.mkdir(srcParent)
      const existing = path.join(destParent, 'Show')
      const incoming = path.join(srcParent, 'Show')
      await fsp.mkdir(existing)
      await fsp.mkdir(incoming)
      await fsp.writeFile(path.join(existing, 'kept.txt'), 'dest')
      await fsp.writeFile(path.join(incoming, 'added.txt'), 'src')
      const adsPath = `${existing}:mfe_test_note`
      await fsp.writeFile(adsPath, 'preserve-me', 'utf8')

      await copyEntries([incoming], destParent, 'replace')
      await expect(fsp.readFile(adsPath, 'utf8')).resolves.toBe('preserve-me')
      await expect(fsp.readFile(path.join(existing, 'added.txt'), 'utf8')).resolves.toBe('src')
    }
  )
})
