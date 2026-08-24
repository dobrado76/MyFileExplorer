import { describe, expect, it } from 'vitest'
import {
  buildScriptCliArgs,
  buildSpawnPlan,
  formatInputManifest,
  parseInputManifest
} from '../shared/scriptCli'
import { expandArgsTemplate } from '../shared/contextMenuCommands'

describe('script CLI argv', () => {
  it('builds folder argv with unicode, spaces, recursive and dry-run', () => {
    const args = buildScriptCliArgs({
      mode: 'folder',
      root: 'D:\\Photos\\Café shots',
      recursive: true,
      dryRun: true,
      params: { quality: 90, force: true, skip: false }
    })
    expect(args).toEqual([
      '--root',
      'D:\\Photos\\Café shots',
      '--recursive',
      '--dry-run',
      '--quality',
      '90',
      '--force'
    ])
  })

  it('builds selection argv via manifest path only', () => {
    const args = buildScriptCliArgs({
      mode: 'selection',
      manifestPath: 'C:\\Users\\x\\AppData\\Local\\Temp\\list.txt',
      params: { tag: 'a b' }
    })
    expect(args[0]).toBe('--input-list')
    expect(args[1]).toBe('C:\\Users\\x\\AppData\\Local\\Temp\\list.txt')
    expect(args).toContain('a b')
    expect(args.join(' ')).not.toContain('|')
    expect(args.join(' ')).not.toContain('&&')
  })

  it('rejects folder mode without root', () => {
    expect(() => buildScriptCliArgs({ mode: 'folder' })).toThrow(/--root/)
  })

  it('builds global argv without --root or --input-list', () => {
    const args = buildScriptCliArgs({
      mode: 'global',
      dryRun: true,
      params: { limit: 10 }
    })
    expect(args).toEqual(['--dry-run', '--limit', '10'])
    expect(args.join(' ')).not.toContain('--root')
    expect(args.join(' ')).not.toContain('--input-list')
  })

  it('round-trips manifest lines', () => {
    const paths = ['C:\\Users\\x\\a file.txt', 'D:\\日本語\\写真.png']
    const text = formatInputManifest(paths)
    expect(parseInputManifest(text)).toEqual(paths)
  })

  it('spawns powershell as exe + argv (no shell)', () => {
    const plan = buildSpawnPlan({
      language: 'powershell',
      scriptPath: 'C:\\scripts\\run.ps1',
      cliArgs: ['--root', 'D:\\a & b'],
      available: { powershell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }
    })
    expect(plan.executable).toMatch(/powershell/i)
    expect(plan.args).toEqual([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\scripts\\run.ps1',
      '--root',
      'D:\\a & b'
    ])
  })

  it('uses py -3 for the Windows launcher', () => {
    const plan = buildSpawnPlan({
      language: 'python',
      scriptPath: 'C:\\s.py',
      cliArgs: ['--input-list', 'C:\\m.txt'],
      available: { py: 'C:\\Windows\\py.exe' }
    })
    expect(plan.args[0]).toBe('-3')
    expect(plan.args[1]).toBe('C:\\s.py')
  })
})

describe('shared script tokens', () => {
  it('expands {selectedFiles} like {paths}', () => {
    expect(expandArgsTemplate('{selectedFiles}', ['C:\\a', 'C:\\b'])).toEqual(['C:\\a', 'C:\\b'])
  })

  it('expands {recursive} and {selectionManifest}', () => {
    expect(
      expandArgsTemplate('{recursive} {selectionManifest}', ['C:\\a'], {
        recursive: true,
        selectionManifest: 'C:\\tmp\\m.txt'
      })
    ).toEqual(['--recursive', 'C:\\tmp\\m.txt'])
  })
})
