import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyHostFileTimes, fileTimeToUnixMs } from '../main/fs/adsWin32'

describe('FILETIME → Unix ms', () => {
  it('maps the Unix epoch to 0', () => {
    expect(fileTimeToUnixMs(116444736000000000n)).toBe(0)
  })

  it('maps one second after the Unix epoch to 1000 ms', () => {
    expect(fileTimeToUnixMs(116444736000000000n + 10_000_000n)).toBe(1000)
  })
})

describe('copyHostFileTimes', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
  })

  it('copies modified (and on Windows created) time from source to dest', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfe-times-'))
    dirs.push(dir)
    const src = path.join(dir, 'src.txt')
    const dest = path.join(dir, 'dest.txt')
    await fs.writeFile(src, 'hello')
    const past = new Date('2001-02-03T04:05:06.000Z')
    await fs.utimes(src, past, past)
    await fs.writeFile(dest, 'hello')

    const srcSt = await fs.stat(src)
    const destBefore = await fs.stat(dest)
    expect(Math.abs(destBefore.mtimeMs - srcSt.mtimeMs)).toBeGreaterThan(1000)

    copyHostFileTimes(src, dest)

    const destAfter = await fs.stat(dest)
    expect(Math.abs(destAfter.mtimeMs - srcSt.mtimeMs)).toBeLessThan(30)
    if (process.platform === 'win32') {
      expect(Math.abs(destAfter.birthtimeMs - srcSt.birthtimeMs)).toBeLessThan(30)
    }
  })

  it('copies folder created/modified times after the dest exists', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfe-times-dir-'))
    dirs.push(dir)
    const src = path.join(dir, 'src')
    const dest = path.join(dir, 'dest')
    await fs.mkdir(src)
    const past = new Date('2002-03-04T05:06:07.000Z')
    await fs.utimes(src, past, past)
    await fs.mkdir(dest)

    copyHostFileTimes(src, dest)

    const srcSt = await fs.stat(src)
    const destSt = await fs.stat(dest)
    expect(Math.abs(destSt.mtimeMs - srcSt.mtimeMs)).toBeLessThan(30)
    if (process.platform === 'win32') {
      expect(Math.abs(destSt.birthtimeMs - srcSt.birthtimeMs)).toBeLessThan(30)
    }
  })
})
