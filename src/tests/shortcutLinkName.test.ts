import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { shortcutLinkName } from '../main/fs/shortcuts'

describe('shortcutLinkName', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
  })

  async function tempDir(): Promise<string> {
    const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-lnk-name-'))
    dirs.push(d)
    return d
  }

  it('prefers Name.ext.lnk when free', async () => {
    const dest = await tempDir()
    await expect(shortcutLinkName(dest, 'app.exe')).resolves.toBe('app.exe.lnk')
    await expect(shortcutLinkName(dest, 'run.bat')).resolves.toBe('run.bat.lnk')
  })

  it('falls back to Name - Shortcut.lnk when preferred exists', async () => {
    const dest = await tempDir()
    await fsp.writeFile(path.join(dest, 'app.exe.lnk'), '')
    await expect(shortcutLinkName(dest, 'app.exe')).resolves.toBe('app.exe - Shortcut.lnk')
  })
})
