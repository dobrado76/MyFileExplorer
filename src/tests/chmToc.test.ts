import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mfe-test' },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() }
}))

import { decodeChmTextBuffer, parseHhcContents, resolveHhExePath } from '../main/preview/chm'

const SAMPLE_HHC = `
<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">
<HTML><BODY>
<OBJECT type="text/site properties">
  <param name="Window Styles" value="0x800025">
</OBJECT>
<UL>
  <LI> <OBJECT type="text/sitemap">
    <param name="Name" value="Welcome">
    <param name="Local" value="welcome.htm">
    </OBJECT>
  <LI> <OBJECT type="text/sitemap">
    <param name="Name" value="Chapter 1">
    </OBJECT>
  <UL>
    <LI> <OBJECT type="text/sitemap">
      <param name="Name" value="Topic A">
      <param name="Local" value="ch1/a.htm">
      </OBJECT>
    <LI> <OBJECT type="text/sitemap">
      <param name="Name" value="Topic B">
      <param name="Local" value="ch1\\b.htm">
      </OBJECT>
  </UL>
  <LI> <OBJECT type="text/sitemap">
    <param name="Name" value="Evil">
    <param name="Local" value="../escape.htm">
    </OBJECT>
</UL>
</BODY></HTML>
`

describe('parseHhcContents', () => {
  it('builds a nested TOC from sitemap objects', () => {
    const toc = parseHhcContents(SAMPLE_HHC)
    expect(toc).toHaveLength(3)
    expect(toc[0]).toMatchObject({ name: 'Welcome', local: 'welcome.htm', children: [] })
    expect(toc[1]?.name).toBe('Chapter 1')
    expect(toc[1]?.children).toHaveLength(2)
    expect(toc[1]?.children[0]).toMatchObject({ name: 'Topic A', local: 'ch1/a.htm' })
    expect(toc[1]?.children[1]).toMatchObject({ name: 'Topic B', local: 'ch1/b.htm' })
  })

  it('drops path-traversal Locals', () => {
    const toc = parseHhcContents(SAMPLE_HHC)
    const evil = toc.find((t) => t.name === 'Evil')
    expect(evil?.local).toBeUndefined()
  })

  it('ignores non-sitemap objects', () => {
    const toc = parseHhcContents(SAMPLE_HHC)
    expect(toc.every((t) => t.name !== 'Window Styles')).toBe(true)
  })
})

describe('decodeChmTextBuffer', () => {
  it('decodes Windows-1252 curly apostrophe (0x92) in HHC titles', () => {
    // "What's New" as HTML Help Workshop writes it (CP1252)
    const buf = Buffer.from([0x57, 0x68, 0x61, 0x74, 0x92, 0x73, 0x20, 0x4e, 0x65, 0x77])
    expect(decodeChmTextBuffer(buf)).toBe('What\u2019s New')
  })

  it('keeps well-formed UTF-8', () => {
    const buf = Buffer.from('What\u2019s New', 'utf8')
    expect(decodeChmTextBuffer(buf)).toBe('What\u2019s New')
  })
})

describe('resolveHhExePath', () => {
  it('prefers %SystemRoot%\\hh.exe when present', () => {
    const root = process.env.SystemRoot || 'C:\\Windows'
    const hit = path.join(root, 'hh.exe')
    const found = resolveHhExePath((p) => p.toLowerCase() === hit.toLowerCase())
    expect(found?.toLowerCase()).toBe(hit.toLowerCase())
  })

  it('falls back to SysWOW64 when root hh.exe is missing', () => {
    const root = process.env.SystemRoot || 'C:\\Windows'
    const hit = path.join(root, 'SysWOW64', 'hh.exe')
    const found = resolveHhExePath((p) => p.toLowerCase() === hit.toLowerCase())
    expect(found?.toLowerCase()).toBe(hit.toLowerCase())
  })

  it('returns null when no candidate exists', () => {
    expect(resolveHhExePath(() => false)).toBeNull()
  })
})

