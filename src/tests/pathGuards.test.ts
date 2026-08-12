import { describe, it, expect, beforeAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  net: { fetch: vi.fn() }
}))

import { normalizeAbsolute, ProtocolAllowlist, isSameOrUnder } from '../main/security/paths'
import {
  chmMediaUrlFor,
  mediaPathFromUrl,
  mediaUrlFor,
  registerChmExtractRoot
} from '../main/media/protocol'

const TMP = path.join(process.cwd(), '.tmp', 'path-guards')

beforeAll(() => {
  fs.mkdirSync(path.join(TMP, 'allowed'), { recursive: true })
  fs.mkdirSync(path.join(TMP, 'secret'), { recursive: true })
  fs.writeFileSync(path.join(TMP, 'allowed', 'ok.txt'), 'ok')
  fs.writeFileSync(path.join(TMP, 'secret', 'no.txt'), 'no')
})

describe('normalizeAbsolute', () => {
  it('accepts absolute windows paths', () => {
    expect(normalizeAbsolute('C:\\Users\\x')).toBe('C:\\Users\\x')
  })
  it('normalizes bare drive to root', () => {
    expect(normalizeAbsolute('C:')).toBe('C:\\')
  })
  it('rejects relative paths', () => {
    expect(normalizeAbsolute('foo\\bar')).toBeNull()
    expect(normalizeAbsolute('.')).toBeNull()
  })
  it('rejects empty input', () => {
    expect(normalizeAbsolute('')).toBeNull()
    expect(normalizeAbsolute('   ')).toBeNull()
  })
  it('resolves .. segments instead of leaving escapes', () => {
    expect(normalizeAbsolute('C:\\a\\b\\..\\c')).toBe('C:\\a\\c')
  })
  it('preserves bare UNC hosts (Node path.normalize would collapse them)', () => {
    expect(normalizeAbsolute('\\\\newonyx')).toBe('\\\\newonyx')
    expect(normalizeAbsolute('\\\\newonyx\\')).toBe('\\\\newonyx')
    expect(normalizeAbsolute('//newonyx')).toBe('\\\\newonyx')
  })
  it('preserves UNC share and deeper paths', () => {
    expect(normalizeAbsolute('\\\\newonyx\\F')).toBe('\\\\newonyx\\F')
    expect(normalizeAbsolute('\\\\newonyx\\F\\Users')).toBe('\\\\newonyx\\F\\Users')
  })
  it('resolves .. under UNC without climbing past the server', () => {
    expect(normalizeAbsolute('\\\\srv\\share\\a\\..\\b')).toBe('\\\\srv\\share\\b')
    expect(normalizeAbsolute('\\\\srv\\share\\..')).toBe('\\\\srv')
    expect(normalizeAbsolute('\\\\srv\\..')).toBeNull()
  })
})

describe('isSameOrUnder', () => {
  it('is case-insensitive on windows', () => {
    if (process.platform === 'win32') {
      expect(isSameOrUnder('C:\\FOO\\bar', 'c:\\foo')).toBe(true)
    }
  })
  it('does not match sibling prefixes', () => {
    expect(isSameOrUnder('C:\\foobar', 'C:\\foo')).toBe(false)
  })
})

describe('ProtocolAllowlist', () => {
  it('allows files directly inside an allowed dir', () => {
    const list = new ProtocolAllowlist()
    list.allowDir(path.join(TMP, 'allowed'))
    expect(list.isFileAllowed(path.join(TMP, 'allowed', 'ok.txt'))).toBe(true)
  })

  it('rejects files outside allowed dirs', () => {
    const list = new ProtocolAllowlist()
    list.allowDir(path.join(TMP, 'allowed'))
    expect(list.isFileAllowed(path.join(TMP, 'secret', 'no.txt'))).toBe(false)
  })

  it('rejects .. escapes from an allowed dir', () => {
    const list = new ProtocolAllowlist()
    list.allowDir(path.join(TMP, 'allowed'))
    const sneaky = path.join(TMP, 'allowed') + '\\..\\secret\\no.txt'
    expect(list.isFileAllowed(sneaky)).toBe(false)
  })

  it('rejects relative paths', () => {
    const list = new ProtocolAllowlist()
    list.allowDir(path.join(TMP, 'allowed'))
    expect(list.isFileAllowed('allowed/ok.txt')).toBe(false)
  })

  it('permanent dirs allow nested files', () => {
    const list = new ProtocolAllowlist()
    list.allowDirPermanently(TMP)
    expect(list.isFileAllowed(path.join(TMP, 'secret', 'no.txt'))).toBe(true)
  })
})

describe('media protocol URL parsing', () => {
  it('round-trips a path', () => {
    const p = 'C:\\Users\\someone\\img.png'
    expect(mediaPathFromUrl(mediaUrlFor(p))).toBe(p)
  })
  it('round-trips a path with cache-busting version', () => {
    const p = 'C:\\Users\\someone\\img.png'
    expect(mediaPathFromUrl(mediaUrlFor(p, '123-456'))).toBe(p)
  })
  it('rejects other protocols', () => {
    expect(mediaPathFromUrl('file:///C:/x.png')).toBeNull()
  })
  it('rejects missing p parameter', () => {
    expect(mediaPathFromUrl('mfe-media://local/')).toBeNull()
  })

  it('resolves mfe-media://chm/ hash paths under a registered extract root', () => {
    const hash = 'a'.repeat(40)
    const root = path.join(TMP, 'allowed')
    registerChmExtractRoot(hash, root)
    const topic = path.join(root, 'ok.txt')
    const url = chmMediaUrlFor(hash, 'ok.txt', '1')
    expect(mediaPathFromUrl(url)).toBe(topic)
  })

  it('rejects chm URLs that escape the extract root', () => {
    const hash = 'b'.repeat(40)
    registerChmExtractRoot(hash, path.join(TMP, 'allowed'))
    const url = `mfe-media://chm/${hash}/${encodeURIComponent('..')}/${encodeURIComponent('secret')}/no.txt`
    expect(mediaPathFromUrl(url)).toBeNull()
  })
})
