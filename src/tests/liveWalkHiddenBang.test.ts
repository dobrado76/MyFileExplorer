import { describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

vi.mock('../main/fs/winAttrs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../main/fs/winAttrs')>()
  return {
    ...actual,
    pathIsHidden: (absPath: string) =>
      path.basename(absPath).toLowerCase() === '!thumbnails' || actual.pathIsHidden(absPath)
  }
})

import { liveWalkSearch } from '../main/search/liveWalk'

describe('liveWalkSearch hidden !Thumbnails', () => {
  it('omits Hidden !Thumbnails when Show hidden is off', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-hidden-bang-'))
    try {
      await fsp.mkdir(path.join(root, '!Thumbnails'), { recursive: true })
      await fsp.writeFile(path.join(root, 'visible.txt'), 'x')
      const { items } = await liveWalkSearch(
        root,
        '!Thumbnails',
        [],
        100,
        { cancelled: false },
        {},
        0,
        false
      )
      expect(items).toEqual([])
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })

  it('returns Hidden !Thumbnails when Show hidden is on', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-hidden-bang-'))
    try {
      await fsp.mkdir(path.join(root, '!Thumbnails'), { recursive: true })
      await fsp.writeFile(path.join(root, 'visible.txt'), 'x')
      const { items } = await liveWalkSearch(
        root,
        '!Thumbnails',
        [],
        100,
        { cancelled: false },
        {},
        0,
        true
      )
      expect(items.map((i) => i.name)).toEqual(['!Thumbnails'])
      expect(items[0]?.isHidden).toBe(true)
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })

  it('returns Hidden !Thumbnails via attrib:h when Show hidden is off', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-hidden-bang-'))
    try {
      await fsp.mkdir(path.join(root, '!Thumbnails'), { recursive: true })
      // `attrib:h !Thumbnails` treats the bang as NOT after an operator; use folder:!
      const { items } = await liveWalkSearch(
        root,
        'attrib:h folder:!Thumbnails',
        [],
        100,
        { cancelled: false },
        {},
        0,
        false
      )
      expect(items.map((i) => i.name)).toEqual(['!Thumbnails'])
      expect(items[0]?.isHidden).toBe(true)
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })
})
