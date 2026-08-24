import { describe, expect, it } from 'vitest'
import { MFESCRIPT_FORMAT, MFESCRIPT_FORMAT_VERSION } from '../shared/schemas/scripts'
import { parseScriptImport } from '../shared/scriptImport'

describe('parseScriptImport', () => {
  it('imports a raw PowerShell file', () => {
    const src = 'param($root)\nWrite-Output $root\n'
    const g = parseScriptImport('D:\\tools\\file_space_report.ps1', src)
    expect(g.script.language).toBe('powershell')
    expect(g.script.name).toBe('file_space_report')
    expect(g.source).toBe(src)
    expect(g.script.sourceKind).toBe('managed')
  })

  it('imports a raw Python file', () => {
    const g = parseScriptImport('report.py', 'print("ok")\n')
    expect(g.script.language).toBe('python')
    expect(g.script.name).toBe('report')
    expect(g.source).toContain('print')
  })

  it('still imports a .mfescript envelope', () => {
    const src = 'Write-Host hi'
    const g = parseScriptImport(
      'pack.mfescript',
      JSON.stringify({
        format: MFESCRIPT_FORMAT,
        formatVersion: MFESCRIPT_FORMAT_VERSION,
        script: {
          name: 'Packed',
          language: 'powershell',
          interpreter: 'auto',
          scopes: ['folder'],
          recursive: false,
          parameters: [],
          contextMenuEnabled: true,
          destructive: false,
          dryRunSupported: false,
          sourceKind: 'managed',
          category: '',
          matchExtensions: [],
          minSelection: 0,
          dependencies: []
        },
        source: src
      })
    )
    expect(g.script.name).toBe('Packed')
    expect(g.source).toBe(src)
  })

  it('imports a global-scope .mfescript', () => {
    const g = parseScriptImport(
      'pack.mfescript',
      JSON.stringify({
        format: MFESCRIPT_FORMAT,
        formatVersion: MFESCRIPT_FORMAT_VERSION,
        script: {
          name: 'Ping hosts',
          language: 'python',
          interpreter: 'auto',
          scopes: ['global'],
          recursive: false,
          parameters: [],
          contextMenuEnabled: false,
          destructive: false,
          dryRunSupported: false,
          sourceKind: 'managed',
          category: '',
          matchExtensions: [],
          minSelection: 0,
          dependencies: []
        },
        source: 'print("ok")\n'
      })
    )
    expect(g.script.scopes).toEqual(['global'])
    expect(g.script.contextMenuEnabled).toBe(false)
  })

  it('rejects an unknown extension that is not JSON', () => {
    expect(() => parseScriptImport('notes.txt', 'hello')).toThrow(/supported script file/i)
  })
})
