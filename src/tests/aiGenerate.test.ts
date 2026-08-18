import { describe, expect, it } from 'vitest'
import { buildScriptSystemPrompt, extractGeneratedScript } from '../shared/scriptGenerate'

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
  })
})
