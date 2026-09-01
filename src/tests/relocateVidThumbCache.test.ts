import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VID_THUMB_CACHE_DIR, vidThumbFrameFileName } from '../shared/vidThumbCache'
import { relocateVidThumbCacheFrames } from '../main/thumbs/vidCache'

describe('relocateVidThumbCacheFrames', () => {
  const dirs: string[] = []

  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await fsp.rm(d, { recursive: true, force: true })
    }
  })

  async function tmpDir(): Promise<string> {
    const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-vidthumb-'))
    dirs.push(d)
    return d
  }

  it('renames strip frames when the video basename changes', async () => {
    const dir = await tmpDir()
    const cache = path.join(dir, VID_THUMB_CACHE_DIR)
    await fsp.mkdir(cache)
    const oldVideo = path.join(dir, 'clip.mp4')
    const newVideo = path.join(dir, 'renamed.mp4')
    await fsp.writeFile(oldVideo, 'x')
    for (const i of [1, 2, 3]) {
      await fsp.writeFile(path.join(cache, vidThumbFrameFileName('clip.mp4', i)), `f${i}`)
    }

    const n = await relocateVidThumbCacheFrames(oldVideo, newVideo)
    expect(n).toBe(3)
    for (const i of [1, 2, 3]) {
      await expect(
        fsp.stat(path.join(cache, vidThumbFrameFileName('renamed.mp4', i)))
      ).resolves.toMatchObject({ size: 2 })
      await expect(fsp.stat(path.join(cache, vidThumbFrameFileName('clip.mp4', i)))).rejects.toBeTruthy()
    }
  })

  it('moves frames into the destination folder cache on same-volume move', async () => {
    const root = await tmpDir()
    const a = path.join(root, 'a')
    const b = path.join(root, 'b')
    await fsp.mkdir(a)
    await fsp.mkdir(b)
    const oldCache = path.join(a, VID_THUMB_CACHE_DIR)
    await fsp.mkdir(oldCache)
    const oldVideo = path.join(a, 'show.mkv')
    const newVideo = path.join(b, 'show.mkv')
    await fsp.writeFile(path.join(oldCache, vidThumbFrameFileName('show.mkv', 1)), 'frame')

    const n = await relocateVidThumbCacheFrames(oldVideo, newVideo)
    expect(n).toBe(1)
    await expect(
      fsp.stat(path.join(b, VID_THUMB_CACHE_DIR, vidThumbFrameFileName('show.mkv', 1)))
    ).resolves.toBeTruthy()
    await expect(
      fsp.stat(path.join(oldCache, vidThumbFrameFileName('show.mkv', 1)))
    ).rejects.toBeTruthy()
  })

  it('no-ops for non-video paths', async () => {
    const dir = await tmpDir()
    expect(
      await relocateVidThumbCacheFrames(path.join(dir, 'a.txt'), path.join(dir, 'b.txt'))
    ).toBe(0)
  })
})
