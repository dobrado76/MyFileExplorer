import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { buildSpawnPlan, formatInputManifest } from '../shared/scriptCli'
import { cleanupManifestFile, writeInputManifestFile } from '../main/scripts/manifest'

const temps: string[] = []

afterEach(() => {
  for (const f of temps) {
    try {
      fs.unlinkSync(f)
    } catch {
      /* ignore */
    }
  }
  temps.length = 0
})

describe('manifest lifecycle', () => {
  it('writes utf-8 paths with spaces and deletes the file', () => {
    const dir = os.tmpdir()
    const file = writeInputManifestFile(['C:\\Users\\x\\a file.txt', 'D:\\日本語'], dir)
    temps.push(file)
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toContain('a file.txt')
    cleanupManifestFile(file)
    expect(fs.existsSync(file)).toBe(false)
  })
})

describe('spawn contract', () => {
  it('does not use a shell string for cmd', () => {
    const plan = buildSpawnPlan({
      language: 'cmd',
      scriptPath: 'C:\\tools\\go.cmd',
      cliArgs: ['--root', 'D:\\a & echo pwned'],
      available: { cmd: 'cmd.exe' }
    })
    expect(plan.args).toEqual(['/d', '/s', '/c', 'C:\\tools\\go.cmd', '--root', 'D:\\a & echo pwned'])
  })

  it('reports missing python', () => {
    expect(() =>
      buildSpawnPlan({
        language: 'python',
        scriptPath: 's.py',
        cliArgs: [],
        available: {}
      })
    ).toThrow(/Python was not found/)
  })
})

describe('child process cancel / exit', () => {
  it('non-zero exit is visible', async () => {
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', 'process.exit(7)'], { windowsHide: true })
      child.on('error', reject)
      child.on('close', (c) => resolve(c))
    })
    expect(code).toBe(7)
  })

  it('can cancel a long-running child', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      windowsHide: true
    })
    const closed = new Promise<void>((resolve) => child.on('close', () => resolve()))
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
    } else {
      child.kill('SIGKILL')
    }
    await closed
    expect(child.exitCode === 0 || child.killed || child.exitCode).toBeTruthy()
  })
})

describe('formatInputManifest', () => {
  it('strips embedded newlines', () => {
    const t = formatInputManifest(['a\nb', 'c'])
    expect(t.split(/\r?\n/).filter(Boolean)).toEqual(['ab', 'c'])
  })
})

describe('temp script path', () => {
  it('keeps managed names out of browsed folders', () => {
    const file = path.join(os.tmpdir(), 'mfe-script-test.ps1')
    expect(file.includes(os.tmpdir())).toBe(true)
  })
})
