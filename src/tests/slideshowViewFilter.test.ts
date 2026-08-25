import { describe, expect, it, vi, beforeEach } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const settings = {
  viewFilterEnabled: true,
  viewFilterPatterns: [] as string[]
}

vi.mock('../main/settings/store', () => ({
  settingsStore: () => ({
    get: () => settings
  })
}))

vi.mock('../main/fs/winAttrs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../main/fs/winAttrs')>()
  return {
    ...actual,
    pathIsHidden: (absPath: string) => {
      const base = path.basename(absPath).toLowerCase()
      return base === '!thumbnails' || base === 'hidden.jpg' || actual.pathIsHidden(absPath)
    }
  }
})

vi.mock('../main/ipc/events', () => ({
  broadcast: () => undefined
}))

vi.mock('../main/logging', () => ({
  logMain: () => undefined
}))

import { listSlideshowImages } from '../main/slideshow/listImages'

describe('listSlideshowImages view filter', () => {
  beforeEach(() => {
    settings.viewFilterEnabled = true
    settings.viewFilterPatterns = []
  })

  it('skips Hidden !Thumbnails when the toolbar view filter is on', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-ss-vf-'))
    try {
      await fsp.writeFile(path.join(root, 'keep.jpg'), 'x')
      await fsp.mkdir(path.join(root, '!Thumbnails'), { recursive: true })
      await fsp.writeFile(path.join(root, '!Thumbnails', 'skip.jpg'), 'x')
      await fsp.writeFile(path.join(root, 'hidden.jpg'), 'x')

      const { paths } = await listSlideshowImages({
        roots: [root],
        order: 'name',
        ascending: true
      })
      expect(paths.map((p) => path.basename(p))).toEqual(['keep.jpg'])
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })

  it('includes Hidden folders when the toolbar view filter is off', async () => {
    settings.viewFilterEnabled = false
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-ss-vf-off-'))
    try {
      await fsp.writeFile(path.join(root, 'keep.jpg'), 'x')
      await fsp.mkdir(path.join(root, '!Thumbnails'), { recursive: true })
      await fsp.writeFile(path.join(root, '!Thumbnails', 'skip.jpg'), 'x')

      const { paths } = await listSlideshowImages({
        roots: [root],
        order: 'name',
        ascending: true
      })
      expect(paths.map((p) => path.basename(p)).sort()).toEqual(['keep.jpg', 'skip.jpg'])
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })

  it('skips view-filter pattern folders when the eye is on', async () => {
    settings.viewFilterPatterns = ['cache']
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-ss-vf-pat-'))
    try {
      await fsp.writeFile(path.join(root, 'keep.jpg'), 'x')
      await fsp.mkdir(path.join(root, 'cache'), { recursive: true })
      await fsp.writeFile(path.join(root, 'cache', 'no.jpg'), 'x')

      const { paths } = await listSlideshowImages({
        roots: [root],
        order: 'name',
        ascending: true
      })
      expect(paths.map((p) => path.basename(p))).toEqual(['keep.jpg'])
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })
})
