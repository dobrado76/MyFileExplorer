import { describe, expect, it } from 'vitest'
import {
  buildScriptSystemPrompt,
  extractGeneratedScript,
  resolveModifyInstruction
} from '../shared/scriptGenerate'

describe('AI script extract', () => {
  it('parses JSON object', () => {
    const g = extractGeneratedScript(
      JSON.stringify({
        name: 'List large',
        description: 'Find big files',
        language: 'python',
        destructive: false,
        dryRunSupported: true,
        dependencies: ['rich'],
        source: 'print("ok")'
      })
    )
    expect(g.name).toBe('List large')
    expect(g.language).toBe('python')
    expect(g.dependencies).toEqual(['rich'])
  })

  it('falls back to a fenced code block', () => {
    const g = extractGeneratedScript('Here you go:\n```python\nprint(1)\n```')
    expect(g.source).toContain('print(1)')
    expect(g.language).toBe('python')
  })

  it('accepts capitalized language and unwraps the source field', () => {
    const g = extractGeneratedScript(
      JSON.stringify({
        name: 'file_space_report',
        description: 'Scans files from a folder or UTF-8 absolute-path manifest.',
        language: 'Python',
        destructive: false,
        dryRunSupported: true,
        dependencies: [],
        source: 'import os\nprint("Largest file: %s" % human(0))\n'
      })
    )
    expect(g.language).toBe('python')
    expect(g.name).toBe('file_space_report')
    expect(g.source).toMatch(/^import os/)
    expect(g.source).not.toMatch(/^\s*\{/)
    expect(g.source).toContain('Largest file')
  })

  it('unwraps the exact Ask-AI-to-fix envelope the model returned', () => {
    const raw = [
      '{"name":"file_space_report","description":"Scans files from a folder or UTF-8 absolute-path manifest and prints a space-usage report.","language":"Python","destructive":false,"dryRunSupported":true,"dependencies":[],"source":"import os\\nprint(\\"Largest file: %s\\" % human(max((x[\\"size\\"] for x in records), default=0)))\\n"}'
    ].join('')
    const g = extractGeneratedScript(raw)
    expect(g.language).toBe('python')
    expect(g.source.startsWith('import os')).toBe(true)
    expect(g.source).toContain('Largest file')
    expect(g.source).not.toContain('"language"')
  })

  it('does not treat the metadata envelope as script source', () => {
    expect(() =>
      extractGeneratedScript('{"name":"file_space_report","description":"Scans","language":"Python"}')
    ).toThrow(/could not be decoded/i)
  })
})

describe('system prompt privacy', () => {
  it('never embeds user paths or listings', () => {
    const prompt = buildScriptSystemPrompt({
      os: 'win32 10.0',
      runtimes: ['powershell', 'python'],
      target: 'selection',
      language: 'auto',
      recursive: true
    })
    expect(prompt).toMatch(/never receives user files/i)
    expect(prompt).not.toMatch(/[A-Za-z]:\\/)
    expect(prompt).not.toMatch(/\\\\/)
    expect(prompt).toMatch(/--input-list/)
    expect(prompt).toMatch(/--root/)
    expect(prompt).toMatch(/Title Case/)
  })
})

describe('resolveModifyInstruction', () => {
  it('prefers the dedicated instruction', () => {
    expect(resolveModifyInstruction('fix the walk', 'rewrite as a report')).toBe('fix the walk')
  })

  it('falls back to the task text', () => {
    expect(resolveModifyInstruction('  ', "don't find any files")).toBe("don't find any files")
  })
})
