import { describe, expect, it } from 'vitest'
import {
  previewPowerRename,
  replaceInText,
  transformBasename,
  type PowerRenameOptions
} from '../shared/powerRename'

const base: PowerRenameOptions = {
  search: '',
  replace: '',
  regex: false,
  matchAll: false,
  caseSensitive: false,
  applyTo: 'full'
}

describe('replaceInText', () => {
  it('literal first-only vs match all (PowerToys powertoys-powerrename example)', () => {
    const opts = { search: 'power', replace: 'super', regex: false, matchAll: false, caseSensitive: false }
    expect(replaceInText('powertoys-powerrename.txt', opts).text).toBe('supertoys-powerrename.txt')
    expect(replaceInText('powertoys-powerrename.txt', { ...opts, matchAll: true }).text).toBe(
      'supertoys-superrename.txt'
    )
  })

  it('case sensitive', () => {
    const opts = {
      search: 'Foo',
      replace: 'Bar',
      regex: false,
      matchAll: true,
      caseSensitive: true
    }
    expect(replaceInText('Foo foo FOO', opts).text).toBe('Bar foo FOO')
    expect(replaceInText('Foo foo FOO', { ...opts, caseSensitive: false }).text).toBe('Bar Bar Bar')
  })

  it('regex with capture groups', () => {
    const r = replaceInText('photo.png', {
      search: '(.*)\\.png',
      replace: 'foo_$1.png',
      regex: true,
      matchAll: true,
      caseSensitive: false
    })
    expect(r.error).toBeUndefined()
    expect(r.text).toBe('foo_photo.png')
  })

  it('invalid regex returns error', () => {
    const r = replaceInText('a', {
      search: '(',
      replace: 'x',
      regex: true,
      matchAll: false,
      caseSensitive: false
    })
    expect(r.error).toBeTruthy()
    expect(r.text).toBe('a')
  })
})

describe('transformBasename', () => {
  it('filename only leaves extension', () => {
    const r = transformBasename('vacation.jpg', {
      ...base,
      search: 'vacation',
      replace: 'trip',
      applyTo: 'name'
    })
    expect(r.newName).toBe('trip.jpg')
  })

  it('extension only', () => {
    const r = transformBasename('notes.txt', {
      ...base,
      search: 'txt',
      replace: 'md',
      applyTo: 'ext'
    })
    expect(r.newName).toBe('notes.md')
  })

  it('full name including extension', () => {
    const r = transformBasename('a.txt', {
      ...base,
      search: 'txt',
      replace: 'bak',
      matchAll: true,
      applyTo: 'full'
    })
    expect(r.newName).toBe('a.bak')
  })

  it('rejects empty result', () => {
    const r = transformBasename('abc', {
      ...base,
      search: '.*',
      replace: '',
      regex: true,
      matchAll: true,
      applyTo: 'full'
    })
    expect(r.error).toMatch(/empty/i)
  })
})

describe('previewPowerRename', () => {
  it('marks willRename only when name changes', () => {
    const rows = previewPowerRename(
      [
        { path: 'C:\\a\\foo.txt', name: 'foo.txt' },
        { path: 'C:\\a\\bar.txt', name: 'bar.txt' }
      ],
      { ...base, search: 'foo', replace: 'baz', applyTo: 'name' }
    )
    expect(rows[0]!.willRename).toBe(true)
    expect(rows[0]!.newName).toBe('baz.txt')
    expect(rows[1]!.willRename).toBe(false)
  })
})
