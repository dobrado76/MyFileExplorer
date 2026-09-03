import { describe, expect, it } from 'vitest'
import {
  countActiveAdvanced,
  defaultPowerRenameAdvanced,
  defaultPowerRenameOptions,
  dosWildcardToRegExp,
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

describe('dosWildcardToRegExp', () => {
  it('maps * and ? and escapes other metacharacters', () => {
    expect(dosWildcardToRegExp('*.txt')).toBe('.*\\.txt')
    expect(dosWildcardToRegExp('photo??.jpg')).toBe('photo..\\.jpg')
    expect(dosWildcardToRegExp('file.v1')).toBe('file\\.v1')
    expect(dosWildcardToRegExp('a+b')).toBe('a\\+b')
  })
})

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

  it('DOS wildcards when regex is off', () => {
    expect(
      replaceInText('vacation.jpg', {
        search: 'vac*.jpg',
        replace: 'trip.jpg',
        regex: false,
        matchAll: false,
        caseSensitive: false
      }).text
    ).toBe('trip.jpg')
    expect(
      replaceInText('photo12.jpg', {
        search: 'photo??.jpg',
        replace: 'pic.jpg',
        regex: false,
        matchAll: false,
        caseSensitive: false
      }).text
    ).toBe('pic.jpg')
    // literal dot — not "any char"
    expect(
      replaceInText('fileXv1.txt', {
        search: 'file.v1.txt',
        replace: 'x',
        regex: false,
        matchAll: false,
        caseSensitive: false
      }).text
    ).toBe('fileXv1.txt')
  })

  it('regex mode keeps * as quantifier', () => {
    expect(
      replaceInText('aaa', {
        search: 'a*',
        replace: 'x',
        regex: true,
        matchAll: false,
        caseSensitive: false
      }).text
    ).toBe('x')
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

  it('numbering works with empty search', () => {
    const adv = defaultPowerRenameAdvanced()
    adv.numberMode = 'prefix'
    adv.numberPad = 2
    adv.numberSep = '_'
    const r = transformBasename(
      'photo.jpg',
      { ...base, applyTo: 'name', advanced: adv },
      { sequenceIndex: 0, parentPath: 'C:\\a' },
      { path: 'C:\\a\\photo.jpg', name: 'photo.jpg' }
    )
    expect(r.newName).toBe('01_photo.jpg')
  })

  it('add prefix/suffix and case', () => {
    const adv = defaultPowerRenameAdvanced()
    adv.addPrefix = 'NEW_'
    adv.addSuffix = '_v2'
    adv.caseMode = 'upper'
    const r = transformBasename('hello world.jpg', {
      ...base,
      applyTo: 'name',
      advanced: adv
    })
    expect(r.newName).toBe('NEW_HELLO WORLD_v2.jpg')
  })

  it('remove first/last and chars', () => {
    const adv = defaultPowerRenameAdvanced()
    adv.removeFirst = 4
    adv.removeChars = '-'
    const r = transformBasename('IMG_vacation-2020.jpg', {
      ...base,
      applyTo: 'name',
      advanced: adv
    })
    expect(r.newName).toBe('vacation2020.jpg')
  })

  it('fixed name + extension fixed', () => {
    const adv = defaultPowerRenameAdvanced()
    adv.nameMode = 'fixed'
    adv.nameFixed = 'cover'
    adv.extMode = 'fixed'
    adv.extFixed = 'png'
    const r = transformBasename('anything.JPG', {
      ...base,
      applyTo: 'name',
      advanced: adv
    })
    expect(r.newName).toBe('cover.png')
  })

  it('append folder name', () => {
    const adv = defaultPowerRenameAdvanced()
    adv.folderMode = 'prefix'
    adv.folderSep = '_'
    adv.folderLevels = 1
    const r = transformBasename(
      'clip.mp4',
      { ...base, applyTo: 'name', advanced: adv },
      { sequenceIndex: 0, parentPath: 'E:\\Movies\\All' },
      { path: 'E:\\Movies\\All\\clip.mp4', name: 'clip.mp4' }
    )
    expect(r.newName).toBe('All_clip.mp4')
  })

  it('auto date from modified', () => {
    const adv = defaultPowerRenameAdvanced()
    adv.dateMode = 'suffix'
    adv.dateType = 'modified'
    adv.dateFmt = 'ymd'
    adv.dateSep = '-'
    const r = transformBasename(
      'shot.jpg',
      { ...base, applyTo: 'name', advanced: adv },
      { sequenceIndex: 0, parentPath: 'C:\\p' },
      { path: 'C:\\p\\shot.jpg', name: 'shot.jpg', mtimeMs: Date.UTC(2024, 0, 15, 12, 0, 0) }
    )
    // Local timezone may shift the UTC day — accept YYYY-MM-DD shape
    expect(r.newName).toMatch(/^shot-\d{4}-\d{2}-\d{2}\.jpg$/)
  })

  it('pipeline: replace then case then add', () => {
    const adv = defaultPowerRenameAdvanced()
    adv.caseMode = 'upper'
    adv.addSuffix = '_X'
    const r = transformBasename('foo.jpg', {
      ...base,
      search: 'foo',
      replace: 'bar',
      applyTo: 'name',
      advanced: adv
    })
    expect(r.newName).toBe('BAR_X.jpg')
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

  it('selection filter excludes and numbering skips them', () => {
    const adv = defaultPowerRenameAdvanced()
    adv.filter = '*.jpg'
    adv.numberMode = 'prefix'
    adv.numberPad = 1
    adv.numberSep = '-'
    const rows = previewPowerRename(
      [
        { path: 'C:\\a\\a.jpg', name: 'a.jpg', kind: 'file' },
        { path: 'C:\\a\\b.txt', name: 'b.txt', kind: 'file' },
        { path: 'C:\\a\\c.jpg', name: 'c.jpg', kind: 'file' }
      ],
      { ...base, applyTo: 'name', advanced: adv }
    )
    expect(rows[0]!.excluded).toBe(false)
    expect(rows[0]!.newName).toBe('1-a.jpg')
    expect(rows[1]!.excluded).toBe(true)
    expect(rows[1]!.willRename).toBe(false)
    expect(rows[2]!.newName).toBe('2-c.jpg')
  })

  it('filterFolders false excludes dirs', () => {
    const adv = defaultPowerRenameAdvanced()
    adv.filterFolders = false
    adv.addPrefix = 'X_'
    const rows = previewPowerRename(
      [
        { path: 'C:\\a\\folder', name: 'folder', kind: 'dir' },
        { path: 'C:\\a\\f.txt', name: 'f.txt', kind: 'file' }
      ],
      { ...base, applyTo: 'name', advanced: adv }
    )
    expect(rows[0]!.excluded).toBe(true)
    expect(rows[1]!.newName).toBe('X_f.txt')
  })
})

describe('countActiveAdvanced', () => {
  it('is zero for defaults', () => {
    expect(countActiveAdvanced(defaultPowerRenameAdvanced())).toBe(0)
    expect(countActiveAdvanced(defaultPowerRenameOptions().advanced!)).toBe(0)
  })

  it('counts active panels', () => {
    const adv = defaultPowerRenameAdvanced()
    adv.caseMode = 'lower'
    adv.numberMode = 'suffix'
    expect(countActiveAdvanced(adv)).toBe(2)
  })
})
