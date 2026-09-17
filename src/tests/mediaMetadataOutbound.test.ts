import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { requireMediaMetadataNetworkTarget } from '../main/mediaMetadata/outboundPrivacy'

describe('requireMediaMetadataNetworkTarget', () => {
  const roots: string[] = []

  afterEach(async () => {
    for (const r of roots.splice(0)) {
      await fsp.rm(r, { recursive: true, force: true })
    }
  })

  async function tmp(): Promise<string> {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-media-outbound-'))
    roots.push(root)
    return root
  }

  it('allows video files and refuses images', async () => {
    const root = await tmp()
    const video = path.join(root, 'Movie.1999.mkv')
    const image = path.join(root, 'poster.jpg')
    await fsp.writeFile(video, 'x')
    await fsp.writeFile(image, 'x')
    await expect(requireMediaMetadataNetworkTarget(video)).resolves.toBe('video-file')
    await expect(requireMediaMetadataNetworkTarget(image)).rejects.toMatchObject({
      code: 'validation'
    })
  })

  it('allows folders that contain a video and refuses empty folders', async () => {
    const root = await tmp()
    const withVideo = path.join(root, 'Show')
    const empty = path.join(root, 'Empty')
    await fsp.mkdir(withVideo)
    await fsp.mkdir(empty)
    await fsp.writeFile(path.join(withVideo, 'S01E01.mkv'), 'x')
    await expect(requireMediaMetadataNetworkTarget(withVideo)).resolves.toBe('video-folder')
    await expect(requireMediaMetadataNetworkTarget(empty)).rejects.toMatchObject({
      code: 'validation'
    })
  })
})
