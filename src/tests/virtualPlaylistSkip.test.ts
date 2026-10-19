import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildVirtualPlaylist,
  clearVirtualPlaylist,
  commitPlayCursor,
  findLivePlayIndex,
  markSkipped,
  pathAtPlayIndex,
  unmarkSkipped
} from '../main/slideshow/virtualPlaylist'

describe('compiled virtual playlist skip', () => {
  let dir: string | null = null

  afterEach(async () => {
    clearVirtualPlaylist()
    if (dir) {
      await rm(dir, { recursive: true, force: true })
      dir = null
    }
  })

  it('drops a deleted path from next, previous, and Home until undo', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'mfe-vpl-'))
    const datPath = path.join(dir, 'list.dat')
    const images = ['C:\\show\\a.jpg', 'C:\\show\\b.jpg', 'C:\\show\\c.jpg']
    await writeFile(datPath, images.join('\r\n'), 'utf8')
    const lines = [{ datPath, count: 1 }]

    const snap = await buildVirtualPlaylist(lines, 'random', true)
    expect(snap.total).toBe(3)
    const opened = pathAtPlayIndex(0)
    expect(opened).toBeTruthy()
    commitPlayCursor(0, opened)

    markSkipped(opened!)
    expect(pathAtPlayIndex(0)).toBeNull()

    const home = findLivePlayIndex(0, 1, false, true)
    expect(home).not.toBeNull()
    expect(home!.path.toLowerCase()).not.toBe(opened!.toLowerCase())

    const next = findLivePlayIndex(0, 1, true, false)
    expect(next).not.toBeNull()
    expect(next!.path.toLowerCase()).not.toBe(opened!.toLowerCase())

    const back = findLivePlayIndex(next!.index, -1, true, false)
    expect(back).not.toBeNull()
    expect(back!.path.toLowerCase()).not.toBe(opened!.toLowerCase())

    const again = await buildVirtualPlaylist(lines, 'random', true)
    expect(pathAtPlayIndex(0)).toBeNull()
    expect(again.path!.toLowerCase()).not.toBe(opened!.toLowerCase())

    unmarkSkipped(opened!)
    expect(pathAtPlayIndex(0)!.toLowerCase()).toBe(opened!.toLowerCase())
    const restored = findLivePlayIndex(0, 1, false, true)
    expect(restored!.path.toLowerCase()).toBe(opened!.toLowerCase())
  })
})
