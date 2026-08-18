import { describe, expect, it } from 'vitest'
import { highlightCode, highlightScriptSource, languageFromPath } from '../renderer/lib/highlight'

describe('languageFromPath', () => {
  it('maps common extensions', () => {
    expect(languageFromPath('C:\\a\\b.ts')).toBe('typescript')
    expect(languageFromPath('C:\\a\\b.tsx')).toBe('typescript')
    expect(languageFromPath('D:\\x.json')).toBe('json')
    expect(languageFromPath('D:\\x.yml')).toBe('yaml')
    expect(languageFromPath('D:\\x.yaml')).toBe('yaml')
    expect(languageFromPath('D:\\x.wlt')).toBe('yaml')
    expect(languageFromPath('D:\\Assets\\Foo.png.meta')).toBe('yaml')
    expect(languageFromPath('D:\\Assets\\Lit.mat')).toBe('yaml')
    expect(languageFromPath('D:\\Assets\\Foo.asset')).toBe('yaml')
    expect(languageFromPath('D:\\Assets\\Dirt.terrainlayer')).toBe('yaml')
    expect(languageFromPath('D:\\Assets\\Scene.lighting')).toBe('yaml')
    expect(languageFromPath('D:\\Assets\\Main.unity')).toBe('yaml')
    expect(languageFromPath('D:\\Assets\\Enemy.prefab')).toBe('yaml')
    expect(languageFromPath('D:\\Assets\\Hero.controller')).toBe('yaml')
    expect(languageFromPath('D:\\Assets\\Walk.anim')).toBe('yaml')
    expect(languageFromPath('D:\\Assets\\Lit.shadergraph')).toBe('json')
    expect(languageFromPath('D:\\Assets\\Lit.shader')).toBe('shader')
    expect(languageFromPath('D:\\Assets\\Box.mtl')).toBe('ini')
    expect(languageFromPath('D:\\App.csproj')).toBe('xml')
    expect(languageFromPath('D:\\App.sln')).toBe('sln')
    expect(languageFromPath('D:\\.vsconfig')).toBe('json')
    expect(languageFromPath('D:\\x.html')).toBe('html')
    expect(languageFromPath('D:\\movie.smi')).toBe('html')
    expect(languageFromPath('D:\\movie.sami')).toBe('html')
    expect(languageFromPath('D:\\x.xml')).toBe('xml')
    expect(languageFromPath('D:\\job.ffs_gui')).toBe('xml')
    expect(languageFromPath('D:\\run.bat')).toBe('dos')
    expect(languageFromPath('D:\\run.cmd')).toBe('dos')
    expect(languageFromPath('D:\\script.vbs')).toBe('vbscript')
    expect(languageFromPath('D:\\tool.ps1')).toBe('powershell')
    expect(languageFromPath('D:\\tool.ps')).toBe('powershell')
    expect(languageFromPath('D:\\types.pyi')).toBe('python')
    expect(languageFromPath('D:\\mod.py')).toBe('python')
    expect(languageFromPath('D:\\movie.srt')).toBe('srt')
    expect(languageFromPath('D:\\movie.sub')).toBe('srt')
    expect(languageFromPath('D:\\meet.ics')).toBe('ics')
    expect(languageFromPath('D:\\meet.ical')).toBe('ics')
    expect(languageFromPath('D:\\note.eml')).toBe('eml')
  })

  it('returns null for unknown extensions', () => {
    expect(languageFromPath('C:\\a\\readme.xyz')).toBeNull()
    expect(languageFromPath('C:\\a\\Makefile')).toBeNull()
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

  it('highlights Visual Studio solution keywords', () => {
    const src = 'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79FBC1}") = "App", "App.csproj", "{AABB}"\n# Visual Studio Version 17\nEndProject'
    const { html, language } = highlightCode(src, 'C:\\App.sln')
    expect(language).toBe('sln')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('EndProject')
    expect(html).toContain('hljs-comment')
    expect(html).toContain('hljs-string')
  })

  it('highlights Unity ShaderLab / HLSL keywords', () => {
    const src = 'Shader "Lit" {\n  SubShader {\n    CGPROGRAM\n    float4 col;\n    // note\n    ENDCG\n  }\n}'
    const { html, language } = highlightCode(src, 'C:\\Lit.shader')
    expect(language).toBe('shader')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('Shader')
    expect(html).toContain('CGPROGRAM')
    expect(html).toContain('hljs-string')
    expect(html).toContain('hljs-comment')
  })

  it('highlights SubRip index, timing, and tags', () => {
    const src = '1\n00:00:01,000 --> 00:00:04,000\nHello <i>world</i>'
    const { html, language } = highlightCode(src, 'C:\\a.srt')
    expect(language).toBe('srt')
    expect(html).toContain('hljs-number')
    expect(html).toContain('00:00:01,000')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('--&gt;')
    expect(html).toContain('hljs-meta')
    expect(html).toContain('&lt;i&gt;')
  })

  it('highlights email headers', () => {
    const src = 'From: a@b.test\nSubject: Hi\n\nBody'
    const { html, language } = highlightCode(src, 'C:\\note.eml')
    expect(language).toBe('eml')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('From')
    expect(html).toContain('hljs-string')
    expect(html).toContain('a@b.test')
    expect(html).toContain('Body')
  })

  it('highlights iCalendar properties and dates', () => {
    const src = 'BEGIN:VCALENDAR\nDTSTART:20260816T100000Z\nSUMMARY:Standup\nEND:VCALENDAR'
    const { html, language } = highlightCode(src, 'C:\\meet.ics')
    expect(language).toBe('ics')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('BEGIN')
    expect(html).toContain('VCALENDAR')
    expect(html).toContain('hljs-number')
    expect(html).toContain('20260816T100000Z')
    expect(html).toContain('hljs-string')
    expect(html).toContain('Standup')
  })

  it('highlights MicroDVD frame ranges', () => {
    const { html, language } = highlightCode('{100}{200}Hi|there', 'C:\\a.sub')
    expect(language).toBe('srt')
    expect(html).toContain('hljs-number')
    expect(html).toContain('{100}')
    expect(html).toContain('Hi|there')
  })

  it('marks # lines as comments for unknown / extensionless files', () => {
    const src = 'hello\n# a note\n  # indented\ncode'
    const { html } = highlightCode(src, 'C:\\notes.txt')
    expect(html).toContain('<span class="hljs-comment"># a note</span>')
    expect(html).toContain('<span class="hljs-comment"># indented</span>')
    expect(html).toContain('hello')
    expect(html).toContain('code')
    expect(html).not.toContain('<span class="hljs-comment">hello')
  })
})

describe('highlightScriptSource', () => {
  it('highlights each script language', () => {
    const py = highlightScriptSource('def foo():\n    return 1', 'python')
    expect(py.language).toBe('python')
    expect(py.html).toContain('hljs-')
    expect(py.html).toContain('def')

    const ps = highlightScriptSource('Write-Host "hi"', 'powershell')
    expect(ps.language).toBe('powershell')
    expect(ps.html).toContain('hljs-')

    const sh = highlightScriptSource('echo "hi"', 'bash')
    expect(sh.language).toBe('bash')
    expect(sh.html).toContain('hljs-')

    const cmd = highlightScriptSource('echo hello', 'cmd')
    expect(cmd.language).toBe('dos')
    expect(cmd.html).toContain('hljs-')
  })
})
