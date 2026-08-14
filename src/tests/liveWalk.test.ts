import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { liveWalkSearch } from '../main/search/liveWalk'

describe('liveWalkSearch', () => {
  let root: string

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-walk-'))
    await fsp.mkdir(path.join(root, 'sub', 'deep'), { recursive: true })
    await fsp.mkdir(path.join(root, 'DecoyFolder'), { recursive: true })
    await fsp.writeFile(path.join(root, 'Alpha.txt'), 'a')
    await fsp.writeFile(path.join(root, 'something.txt'), 'target')
    await fsp.writeFile(path.join(root, 'report.pdf'), 'pdf')
    await fsp.writeFile(path.join(root, 'annual-summary.pdf'), 'pdf2')
    await fsp.writeFile(path.join(root, 'readme.txt'), 'readme')
    await fsp.writeFile(path.join(root, 'random.jpg'), 'jpg decoy')
    await fsp.writeFile(path.join(root, '!!Thumbs.db'), 'thumbs')
    await fsp.writeFile(path.join(root, 'sub', 'MyPhoto.png'), 'b')
    await fsp.writeFile(path.join(root, 'sub', 'deep', 'gamma-trip-2024.bin'), 'c')
    await fsp.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
    await fsp.writeFile(path.join(root, 'node_modules', 'pkg', 'secret-photo.js'), 'x')
  })

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('finds matches recursively in subfolders', async () => {
    const { items, partial } = await liveWalkSearch(root, 'photo', [], 100, {
      cancelled: false
    })
    expect(partial).toBe(false)
    const names = items.map((i) => i.name).sort()
    expect(names).toContain('MyPhoto.png')
    expect(names).toContain('secret-photo.js')
    const photo = items.find((i) => i.name === 'MyPhoto.png')
    expect(photo?.size).toBeGreaterThan(0)
  })

  it('skips excluded directory names entirely', async () => {
    const { items } = await liveWalkSearch(root, 'photo', ['node_modules'], 100, {
      cancelled: false
    })
    expect(items.map((i) => i.name)).toEqual(['MyPhoto.png'])
  })

  it('matches multi-token queries in deep paths', async () => {
    const { items } = await liveWalkSearch(root, 'trip 2024', [], 100, { cancelled: false })
    expect(items).toHaveLength(1)
    expect(items[0]!.name).toBe('gamma-trip-2024.bin')
  })

  it('matches *.ext globs recursively', async () => {
    const { items } = await liveWalkSearch(root, '*.png', [], 100, { cancelled: false })
    expect(items.map((i) => i.name)).toEqual(['MyPhoto.png'])
  })

  describe('basic toolbar search (dotted filenames)', () => {
    it('finds something.txt and excludes unrelated jpgs/folders', async () => {
      const { items } = await liveWalkSearch(root, 'something.txt', [], 100, { cancelled: false })
      const names = items.map((i) => i.name)
      expect(names).toEqual(['something.txt'])
      expect(names).not.toContain('random.jpg')
      expect(names).not.toContain('MyPhoto.png')
      expect(names).not.toContain('DecoyFolder')
    })

    it('finds report.pdf without returning jpgs or folders', async () => {
      const { items } = await liveWalkSearch(root, 'report.pdf', [], 100, { cancelled: false })
      const names = items.map((i) => i.name)
      expect(names).toEqual(['report.pdf'])
      expect(names).not.toContain('random.jpg')
      expect(names).not.toContain('annual-summary.pdf')
    })

    it('finds annual-summary.pdf as a single token', async () => {
      const { items } = await liveWalkSearch(root, 'annual-summary.pdf', [], 100, { cancelled: false })
      expect(items.map((i) => i.name)).toEqual(['annual-summary.pdf'])
    })

    it('finds readme.txt without unrelated decoys', async () => {
      const { items } = await liveWalkSearch(root, 'readme.txt', [], 100, { cancelled: false })
      const names = items.map((i) => i.name)
      expect(names).toEqual(['readme.txt'])
      expect(names).not.toContain('random.jpg')
      expect(names).not.toContain('report.pdf')
    })

    it('finds !!Thumbs.db without returning the rest of the folder', async () => {
      const { items } = await liveWalkSearch(root, '!!Thumbs.db', [], 100, { cancelled: false })
      expect(items.map((i) => i.name)).toEqual(['!!Thumbs.db'])
    })

    it('still name-only when matchPath and regex toggles are on', async () => {
      const { items } = await liveWalkSearch(
        root,
        'something.txt',
        [],
        100,
        { cancelled: false },
        { matchPath: true, regex: true }
      )
      const names = items.map((i) => i.name)
      expect(names).toEqual(['something.txt'])
      expect(names).not.toContain('random.jpg')
      expect(names).not.toContain('DecoyFolder')
    })
  })
})
