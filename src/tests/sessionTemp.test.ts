import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  clearSessionTempDirs,
  clearSessionTempDirsSync,
  isSessionTempDirName
} from '../main/sessionTemp'

describe('session temp dirs', () => {
  it('matches *-scratch, *-preview, and *-remux only', () => {
    expect(isSessionTempDirName('media-scratch')).toBe(true)
    expect(isSessionTempDirName('remote-transfer-scratch')).toBe(true)
    expect(isSessionTempDirName('chm-preview')).toBe(true)
    expect(isSessionTempDirName('PPTX-Preview')).toBe(true)
    expect(isSessionTempDirName('video-remux')).toBe(true)
    expect(isSessionTempDirName('scratch')).toBe(false)
    expect(isSessionTempDirName('preview')).toBe(false)
    expect(isSessionTempDirName('thumbs')).toBe(false)
    expect(isSessionTempDirName('scripts')).toBe(false)
    expect(isSessionTempDirName('video-posters')).toBe(false)
  })

  let root: string

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-session-temp-'))
  })

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('empties matching folders and leaves persistent ones', async () => {
    await fsp.mkdir(path.join(root, 'media-scratch'), { recursive: true })
    await fsp.mkdir(path.join(root, 'pptx-preview'), { recursive: true })
    await fsp.mkdir(path.join(root, 'video-remux'), { recursive: true })
    await fsp.mkdir(path.join(root, 'thumbs'), { recursive: true })
    await fsp.writeFile(path.join(root, 'media-scratch', 'a.bin'), 'a')
    await fsp.writeFile(path.join(root, 'pptx-preview', 'b.bin'), 'b')
    await fsp.writeFile(path.join(root, 'video-remux', 'c.mp4'), 'c')
    await fsp.writeFile(path.join(root, 'thumbs', 'keep.jpg'), 'k')
    await fsp.writeFile(path.join(root, 'settings.json'), '{}')

    await clearSessionTempDirs(root)

    expect(await fsp.readdir(path.join(root, 'media-scratch'))).toEqual([])
    expect(await fsp.readdir(path.join(root, 'pptx-preview'))).toEqual([])
    expect(await fsp.readdir(path.join(root, 'video-remux'))).toEqual([])
    expect(await fsp.readdir(path.join(root, 'thumbs'))).toEqual(['keep.jpg'])
    expect(await fsp.readFile(path.join(root, 'settings.json'), 'utf8')).toBe('{}')
  })

  it('empties synchronously for quit', async () => {
    await fsp.mkdir(path.join(root, 'remote-scratch'), { recursive: true })
    await fsp.writeFile(path.join(root, 'remote-scratch', 'x.bin'), 'x')
    clearSessionTempDirsSync(root)
    expect(await fsp.readdir(path.join(root, 'remote-scratch'))).toEqual([])
  })
})
