import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyEntries } from '../main/fs/ops'
import { readStreamBytes, writeStreamBytes } from '../main/fs/adsWin32'

describe.runIf(process.platform === 'win32')('copy ADS on stream/verify path', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
  })

  async function tempDir(): Promise<string> {
    const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-ads-copy-'))
    dirs.push(d)
    return d
  }

  it('verified copy transfers named ADS (stream path, not CopyFile)', async () => {
    const root = await tempDir()
    const srcDir = path.join(root, 'src')
    const destDir = path.join(root, 'dest')
    await fsp.mkdir(srcDir)
    await fsp.mkdir(destDir)
    const src = path.join(srcDir, 'photo.jpg')
    await fsp.writeFile(src, Buffer.alloc(64, 7))
    await writeStreamBytes(src, 'mfe_test_note', Buffer.from('ads-payload', 'utf8'))

    const res = await copyEntries([src], destDir, 'fail', { verify: true })
    expect(res.issues).toEqual([])
    expect(res.aborted).toBeUndefined()
    const dest = path.join(destDir, 'photo.jpg')
    const ads = await readStreamBytes(dest, 'mfe_test_note')
    expect(ads?.toString('utf8')).toBe('ads-payload')
  })

  it('fresh directory copy transfers directory ADS', async () => {
    const root = await tempDir()
    const srcDir = path.join(root, 'src', 'Show')
    const destParent = path.join(root, 'dest')
    await fsp.mkdir(srcDir, { recursive: true })
    await fsp.mkdir(destParent)
    await fsp.writeFile(path.join(srcDir, 'a.txt'), 'x')
    await writeStreamBytes(srcDir, 'mfe_test_note', Buffer.from('dir-ads', 'utf8'))

    const res = await copyEntries([srcDir], destParent, 'fail')
    expect(res.issues).toEqual([])
    const dest = path.join(destParent, 'Show')
    const ads = await readStreamBytes(dest, 'mfe_test_note')
    expect(ads?.toString('utf8')).toBe('dir-ads')
  })
})
