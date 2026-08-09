import { describe, expect, it } from 'vitest'
import { highlightCode, languageFromPath } from '../renderer/lib/highlight'

describe('languageFromPath', () => {
  it('maps common extensions', () => {
    expect(languageFromPath('C:\\a\\b.ts')).toBe('typescript')
    expect(languageFromPath('C:\\a\\b.tsx')).toBe('typescript')
    expect(languageFromPath('D:\\x.json')).toBe('json')
    expect(languageFromPath('D:\\x.yml')).toBe('yaml')
    expect(languageFromPath('D:\\x.yaml')).toBe('yaml')
    expect(languageFromPath('D:\\x.wlt')).toBe('yaml')
    expect(languageFromPath('D:\\x.html')).toBe('html')
    expect(languageFromPath('D:\\x.xml')).toBe('xml')
    expect(languageFromPath('D:\\job.ffs_gui')).toBe('xml')
    expect(languageFromPath('D:\\run.bat')).toBe('dos')
    expect(languageFromPath('D:\\run.cmd')).toBe('dos')
    expect(languageFromPath('D:\\script.vbs')).toBe('vbscript')
    expect(languageFromPath('D:\\tool.ps1')).toBe('powershell')
    expect(languageFromPath('D:\\tool.ps')).toBe('powershell')
  })

  it('returns null for unknown extensions', () => {
    expect(languageFromPath('C:\\a\\readme.xyz')).toBeNull()
  })
})

describe('highlightCode', () => {
  it('highlights JSON', () => {
    const { html, language } = highlightCode('{"a": 1}', 'C:\\t.json')
    expect(language).toBe('json')
    expect(html).toContain('hljs-')
    expect(html).not.toContain('{"a"')
  })

  it('escapes plaintext for unknown types', () => {
    const { html } = highlightCode('<script>', 'C:\\t.unknownext')
    expect(html).toBe('&lt;script&gt;')
  })
})
