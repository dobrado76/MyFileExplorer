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
    await fsp.writeFile(path.join(root, 'Alpha.txt'), 'a')
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
})
