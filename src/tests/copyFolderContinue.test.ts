import type { Dirent } from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyEntries, planFileOp } from '../main/fs/ops'
import * as watch from '../main/fs/watch'

describe('folder copy keeps filling the destination it created', () => {
  const dirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(dirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
  })

  async function tempDir(): Promise<string> {
    const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-copy-cont-'))
    dirs.push(d)
    return d
  }

  it('copies the rest of the folder when one child cannot be written', async () => {
    const root = await tempDir()
    const destParent = path.join(root, 'dest')
    const srcParent = path.join(root, 'src')
    await fsp.mkdir(destParent)
    await fsp.mkdir(srcParent)
    const incoming = path.join(srcParent, 'Album')
    const existing = path.join(destParent, 'Album')
    await fsp.mkdir(incoming)
    await fsp.mkdir(existing)
    await fsp.writeFile(path.join(incoming, 'a.txt'), 'aaa')
    await fsp.mkdir(path.join(incoming, 'sub'))
    await fsp.writeFile(path.join(incoming, 'sub', 'b.txt'), 'bbb')
    await fsp.writeFile(path.join(incoming, 'clash'), 'file')
    await fsp.mkdir(path.join(existing, 'clash'))

    const res = await copyEntries([incoming], destParent, 'replace')
    expect(res.copied).toEqual([existing])
    expect(res.issues).toHaveLength(1)
    expect(res.issues[0]?.source).toBe(path.join(incoming, 'clash'))
    expect(res.issues[0]?.dest).toBe(path.join(existing, 'clash'))
    await expect(fsp.readFile(path.join(existing, 'a.txt'), 'utf8')).resolves.toBe('aaa')
    await expect(fsp.readFile(path.join(existing, 'sub', 'b.txt'), 'utf8')).resolves.toBe('bbb')
    await expect(fsp.lstat(path.join(existing, 'clash'))).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    })
    expect((await fsp.lstat(path.join(existing, 'clash'))).isDirectory()).toBe(true)
  })

  it('treats an existing destination directory as the folder to fill, even if mkdir reports EEXIST', async () => {
    const root = await tempDir()
    const destParent = path.join(root, 'dest')
    const srcParent = path.join(root, 'src')
    await fsp.mkdir(destParent)
    await fsp.mkdir(srcParent)
    const incoming = path.join(srcParent, 'Album')
    const existing = path.join(destParent, 'Album')
    await fsp.mkdir(incoming)
    await fsp.mkdir(existing)
    await fsp.mkdir(path.join(existing, 'nested'))
    await fsp.writeFile(path.join(incoming, 'a.txt'), 'aaa')
    await fsp.mkdir(path.join(incoming, 'nested'))
    await fsp.writeFile(path.join(incoming, 'nested', 'b.txt'), 'bbb')

    const mkdir = fsp.mkdir.bind(fsp)
    vi.spyOn(fsp, 'mkdir').mockImplementation(async (dir, opts) => {
      const target = String(dir)
      try {
        const st = await fsp.lstat(target)
        if (st.isDirectory() && !st.isSymbolicLink()) {
          throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
        }
      } catch (e) {
        const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
        if (code === 'EEXIST') throw e
        if (code !== 'ENOENT') throw e
      }
      return mkdir(dir, opts)
    })

    const res = await copyEntries([incoming], destParent, 'replace')
    expect(res.issues).toEqual([])
    expect(res.copied).toEqual([existing])
    await expect(fsp.readFile(path.join(existing, 'a.txt'), 'utf8')).resolves.toBe('aaa')
    await expect(fsp.readFile(path.join(existing, 'nested', 'b.txt'), 'utf8')).resolves.toBe('bbb')
  })

  it('copies a new folder without reporting the folder it just created', async () => {
    const root = await tempDir()
    const destParent = path.join(root, 'dest')
    const srcParent = path.join(root, 'src')
    await fsp.mkdir(destParent)
    await fsp.mkdir(srcParent)
    const incoming = path.join(srcParent, 'Album')
    await fsp.mkdir(path.join(incoming, 'sub'), { recursive: true })
    await fsp.writeFile(path.join(incoming, 'a.txt'), 'aaa')
    await fsp.writeFile(path.join(incoming, 'sub', 'b.txt'), 'bbb')

    const res = await copyEntries([incoming], destParent, 'fail')
    const target = path.join(destParent, 'Album')
    expect(res.issues).toEqual([])
    expect(res.copied).toEqual([target])
    await expect(fsp.readFile(path.join(target, 'a.txt'), 'utf8')).resolves.toBe('aaa')
    await expect(fsp.readFile(path.join(target, 'sub', 'b.txt'), 'utf8')).resolves.toBe('bbb')
  })

  it('shows the new folder in the list as soon as that folder is created', async () => {
    const root = await tempDir()
    const destParent = path.join(root, 'dest')
    const srcParent = path.join(root, 'src')
    await fsp.mkdir(destParent)
    await fsp.mkdir(srcParent)
    const incoming = path.join(srcParent, 'Album')
    await fsp.mkdir(incoming)
    await fsp.writeFile(path.join(incoming, 'a.txt'), 'aaa')
    const spy = vi.spyOn(watch, 'emitFsChanged')

    const res = await copyEntries([incoming], destParent, 'fail')
    expect(res.issues).toEqual([])
    const hit = spy.mock.calls.find(
      (call) => String(call[0]).toLowerCase() === destParent.toLowerCase()
    )
    expect(hit?.[1]).toEqual({ bypassMute: true })
  })

  it('copies ordinary nested folders with no review', async () => {
    const root = await tempDir()
    const destParent = path.join(root, 'dest')
    const srcParent = path.join(root, 'src')
    await fsp.mkdir(destParent)
    await fsp.mkdir(srcParent)
    const incoming = path.join(srcParent, 'Album')
    await fsp.mkdir(incoming)
    for (const name of ['comfyui-lora-training', 'node_modules', 'out', 'reference', 'resources']) {
      const dir = path.join(incoming, name)
      await fsp.mkdir(path.join(dir, 'nested'), { recursive: true })
      await fsp.writeFile(path.join(dir, 'nested', 'a.txt'), name)
    }

    const res = await copyEntries([incoming], destParent, 'fail')
    const target = path.join(destParent, 'Album')
    expect(res.issues).toEqual([])
    expect(res.copied).toEqual([target])
    for (const name of ['comfyui-lora-training', 'node_modules', 'out', 'reference', 'resources']) {
      await expect(fsp.readFile(path.join(target, name, 'nested', 'a.txt'), 'utf8')).resolves.toBe(name)
    }
  })

  it('copies an ASAR package as one physical file', async () => {
    const root = await tempDir()
    const destParent = path.join(root, 'dest')
    const srcParent = path.join(root, 'src')
    await fsp.mkdir(destParent)
    await fsp.mkdir(srcParent)
    const incoming = path.join(srcParent, 'ElectronApp')
    const asar = path.join(incoming, 'resources', 'app.asar')
    const bytes = Buffer.from('synthetic-asar-bytes')
    await fsp.mkdir(path.dirname(asar), { recursive: true })
    await fsp.writeFile(asar, bytes)

    const res = await copyEntries([incoming], destParent, 'fail')
    const copiedAsar = path.join(destParent, 'ElectronApp', 'resources', 'app.asar')
    expect(res.issues).toEqual([])
    expect((await fsp.lstat(copiedAsar)).isFile()).toBe(true)
    await expect(fsp.readFile(copiedAsar)).resolves.toEqual(bytes)
  })

  it('copies an asar archive as one file when stat reports a folder, including verify', async () => {
    const root = await tempDir()
    const destParent = path.join(root, 'dest')
    const srcParent = path.join(root, 'src')
    await fsp.mkdir(destParent)
    await fsp.mkdir(srcParent)
    const incoming = path.join(srcParent, 'ElectronApp')
    const asar = path.join(incoming, 'resources', 'default_app.asar')
    const bytes = Buffer.from('default-app-asar-bytes')
    await fsp.mkdir(path.dirname(asar), { recursive: true })
    await fsp.writeFile(asar, bytes)

    const lstat = fsp.lstat.bind(fsp)
    const readdir = fsp.readdir.bind(fsp)
    const lstatSpy = vi.spyOn(fsp, 'lstat').mockImplementation(async (p, opts) => {
      const real = await lstat(p, opts)
      if (!String(p).toLowerCase().endsWith('.asar')) return real
      return new Proxy(real, {
        get(target, prop, receiver) {
          if (prop === 'isDirectory') return () => true
          if (prop === 'isFile') return () => false
          if (prop === 'isSymbolicLink') return () => false
          if (prop === 'size') return 0
          const value = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        }
      })
    })
    vi.spyOn(fsp, 'readdir').mockImplementation(async (dir, opts) => {
      if (String(dir).toLowerCase().endsWith('.asar')) {
        throw Object.assign(new Error('walked into asar'), { code: 'ENOENT' })
      }
      const ents = (await readdir(dir, opts as never)) as Dirent[]
      if (!opts || typeof opts !== 'object' || !('withFileTypes' in opts)) return ents as never
      return ents.map((ent) => {
        if (!ent.name.toLowerCase().endsWith('.asar')) return ent
        return new Proxy(ent, {
          get(target, prop, receiver) {
            if (prop === 'isDirectory') return () => true
            if (prop === 'isFile') return () => false
            if (prop === 'isSymbolicLink') return () => false
            const value = Reflect.get(target, prop, receiver)
            return typeof value === 'function' ? value.bind(target) : value
          }
        })
      }) as never
    })

    const res = await copyEntries([incoming], destParent, 'fail', { verify: true })
    expect(lstatSpy.mock.calls.some((call) => String(call[0]).toLowerCase().endsWith('.asar'))).toBe(
      true
    )
    const copiedAsar = path.join(destParent, 'ElectronApp', 'resources', 'default_app.asar')
    expect(res.issues).toEqual([])
    expect((await lstat(copiedAsar)).isFile()).toBe(true)
    await expect(fsp.readFile(copiedAsar)).resolves.toEqual(bytes)
    await expect(fsp.readdir(path.dirname(copiedAsar))).resolves.toEqual(['default_app.asar'])
  })

  it('skips electron default_app.asar and release win-unpacked app.asar', async () => {
    const root = await tempDir()
    const destParent = path.join(root, 'dest')
    const srcParent = path.join(root, 'src')
    await fsp.mkdir(destParent)
    await fsp.mkdir(srcParent)
    const incoming = path.join(srcParent, 'Project')
    const electronAsar = path.join(
      incoming,
      'node_modules',
      'electron',
      'dist',
      'resources',
      'default_app.asar'
    )
    const releaseResources = path.join(incoming, 'release', 'win-unpacked', 'resources')
    const releaseApp = path.join(releaseResources, 'app.asar')
    const releaseDefault = path.join(releaseResources, 'default_app.asar')
    const otherAsar = path.join(incoming, 'pkg', 'resources', 'app.asar')
    const note = path.join(incoming, 'note.txt')
    await fsp.mkdir(path.dirname(electronAsar), { recursive: true })
    await fsp.mkdir(releaseResources, { recursive: true })
    await fsp.mkdir(path.dirname(otherAsar), { recursive: true })
    await fsp.writeFile(electronAsar, 'electron-default')
    await fsp.writeFile(path.join(path.dirname(electronAsar), 'keep.txt'), 'electron-keep')
    await fsp.writeFile(releaseApp, 'release-app')
    await fsp.writeFile(releaseDefault, 'release-default')
    await fsp.writeFile(path.join(releaseResources, 'keep.txt'), 'release-keep')
    await fsp.writeFile(otherAsar, 'other-app')
    await fsp.writeFile(note, 'note')

    const omitted = (p: string): boolean => {
      const n = p.replace(/\\/g, '/').toLowerCase()
      return (
        n.endsWith('node_modules/electron/dist/resources/default_app.asar') ||
        n.endsWith('release/win-unpacked/resources/default_app.asar') ||
        n.endsWith('release/win-unpacked/resources/app.asar')
      )
    }
    const readdir = fsp.readdir.bind(fsp)
    vi.spyOn(fsp, 'readdir').mockImplementation(async (dir, opts) => {
      if (omitted(String(dir))) {
        throw Object.assign(new Error('walked into omitted asar'), { code: 'ENOENT' })
      }
      const ents = (await readdir(dir, opts as never)) as Dirent[]
      if (!opts || typeof opts !== 'object' || !('withFileTypes' in opts)) return ents as never
      return ents.map((ent) => {
        if (!omitted(path.join(String(dir), ent.name))) return ent
        return new Proxy(ent, {
          get(target, prop, receiver) {
            if (prop === 'isDirectory') return () => true
            if (prop === 'isFile') return () => false
            if (prop === 'isSymbolicLink') return () => false
            const value = Reflect.get(target, prop, receiver)
            return typeof value === 'function' ? value.bind(target) : value
          }
        })
      }) as never
    })

    const plan = await planFileOp({
      op: 'copy',
      sources: [incoming],
      destinationDir: destParent,
      conflictPolicy: 'fail'
    })
    expect(plan.totals.files).toBe(4)
    expect(plan.totals.bytes).toBe(
      Buffer.byteLength('electron-keep') +
        Buffer.byteLength('release-keep') +
        Buffer.byteLength('other-app') +
        Buffer.byteLength('note')
    )

    const res = await copyEntries([incoming], destParent, 'fail', { verify: true })
    const target = path.join(destParent, 'Project')
    expect(res.issues).toEqual([])
    expect(res.copied).toEqual([target])
    await expect(fsp.readFile(path.join(target, 'note.txt'), 'utf8')).resolves.toBe('note')
    await expect(
      fsp.readFile(
        path.join(target, 'node_modules', 'electron', 'dist', 'resources', 'keep.txt'),
        'utf8'
      )
    ).resolves.toBe('electron-keep')
    await expect(
      fsp.readFile(path.join(target, 'release', 'win-unpacked', 'resources', 'keep.txt'), 'utf8')
    ).resolves.toBe('release-keep')
    await expect(fsp.readFile(path.join(target, 'pkg', 'resources', 'app.asar'), 'utf8')).resolves.toBe(
      'other-app'
    )
    for (const missing of [
      path.join(target, 'node_modules', 'electron', 'dist', 'resources', 'default_app.asar'),
      path.join(target, 'release', 'win-unpacked', 'resources', 'app.asar'),
      path.join(target, 'release', 'win-unpacked', 'resources', 'default_app.asar')
    ]) {
      await expect(fsp.lstat(missing)).rejects.toMatchObject({ code: 'ENOENT' })
    }

    const loneDest = path.join(destParent, 'only')
    await fsp.mkdir(loneDest)
    const lone = await copyEntries([electronAsar], loneDest, 'fail', { verify: true })
    expect(lone.issues).toEqual([])
    expect(lone.skipped.map((p) => p.toLowerCase())).toContain(electronAsar.toLowerCase())
    await expect(fsp.lstat(path.join(loneDest, 'default_app.asar'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('falls back to a native directory copy instead of reporting ENOTDIR for a readable folder', async () => {
    const root = await tempDir()
    const destParent = path.join(root, 'dest')
    const srcParent = path.join(root, 'src')
    await fsp.mkdir(destParent)
    await fsp.mkdir(srcParent)
    const incoming = path.join(srcParent, 'Album')
    const child = path.join(incoming, 'node_modules')
    await fsp.mkdir(child, { recursive: true })
    await fsp.writeFile(path.join(child, 'a.txt'), 'aaa')
    const readdir = fsp.readdir.bind(fsp)
    let injected = false
    vi.spyOn(fsp, 'readdir').mockImplementation(async (dir, opts) => {
      if (!injected && String(dir).toLowerCase() === child.toLowerCase()) {
        injected = true
        throw Object.assign(new Error('ENOTDIR, not a directory'), { code: 'ENOTDIR' })
      }
      return readdir(dir, opts as never) as never
    })

    const res = await copyEntries([incoming], destParent, 'fail')
    const target = path.join(destParent, 'Album')
    expect(injected).toBe(true)
    expect(res.issues).toEqual([])
    expect(res.copied).toEqual([target])
    await expect(fsp.readFile(path.join(target, 'node_modules', 'a.txt'), 'utf8')).resolves.toBe(
      'aaa'
    )
  })

  it.runIf(process.platform === 'win32')(
    'copies a directory junction as files when the link cannot be recreated',
    async () => {
      const root = await tempDir()
      const destParent = path.join(root, 'dest')
      const srcParent = path.join(root, 'src')
      await fsp.mkdir(destParent)
      await fsp.mkdir(srcParent)
      const external = path.join(root, 'external')
      await fsp.mkdir(external)
      await fsp.writeFile(path.join(external, 'b.txt'), 'bbb')
      const incoming = path.join(srcParent, 'Album')
      await fsp.mkdir(incoming)
      await fsp.writeFile(path.join(incoming, 'a.txt'), 'aaa')
      await fsp.symlink(external, path.join(incoming, 'linked'), 'junction')
      vi.spyOn(fsp, 'symlink').mockImplementation(async () => {
        throw Object.assign(new Error('ENOTDIR: not a directory, symlink'), { code: 'ENOTDIR' })
      })

      const res = await copyEntries([incoming], destParent, 'fail')
      const target = path.join(destParent, 'Album')
      expect(res.issues).toEqual([])
      expect(res.copied).toEqual([target])
      await expect(fsp.readFile(path.join(target, 'a.txt'), 'utf8')).resolves.toBe('aaa')
      await expect(fsp.readFile(path.join(target, 'linked', 'b.txt'), 'utf8')).resolves.toBe('bbb')
      const linked = await fsp.lstat(path.join(target, 'linked'))
      expect(linked.isDirectory()).toBe(true)
      expect(linked.isSymbolicLink()).toBe(false)
    },
    20_000
  )

  it.runIf(process.platform === 'win32')(
    'does not walk a junction into the folder being written',
    async () => {
      const root = await tempDir()
      const destParent = path.join(root, 'dest')
      const srcParent = path.join(root, 'src')
      await fsp.mkdir(destParent)
      await fsp.mkdir(srcParent)
      const incoming = path.join(srcParent, 'Album')
      await fsp.mkdir(incoming)
      await fsp.writeFile(path.join(incoming, 'a.txt'), 'aaa')
      await fsp.symlink(incoming, path.join(incoming, 'loop'), 'junction')

      const res = await copyEntries([incoming], destParent, 'fail')
      const target = path.join(destParent, 'Album')
      expect(res.copied).toEqual([target])
      expect(res.issues).toEqual([])
      await expect(fsp.readFile(path.join(target, 'a.txt'), 'utf8')).resolves.toBe('aaa')
      const loopPath = path.join(target, 'loop')
      let loop: Awaited<ReturnType<typeof fsp.lstat>> | undefined
      try {
        loop = await fsp.lstat(loopPath)
      } catch {
        loop = undefined
      }
      if (loop) expect(loop.isDirectory() && !loop.isSymbolicLink()).toBe(false)
    },
    20_000
  )
})
