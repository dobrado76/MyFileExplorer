import { describe, expect, it } from 'vitest'
import {
  depthFromRoot,
  matchTextGroups,
  matchTextPred,
  parseEverythingQuery,
  rowMatchesStructured
} from '../main/search/everythingQuery'
import { fixtureNames } from './searchFixtures'

const row = (over: Partial<Parameters<typeof rowMatchesStructured>[0]> & { path: string; name: string }) =>
  ({
    size: 0,
    mtimeMs: 0,
    isDir: false,
    ...over
  }) as Parameters<typeof rowMatchesStructured>[0]

describe('parseEverythingQuery', () => {
  it('parses AND tokens and OR groups', () => {
    const q = parseEverythingQuery('foo bar')
    expect(q.textGroups).toHaveLength(2)
    const or = parseEverythingQuery('a|b c')
    expect(or.textGroups[0]?.length).toBe(2)
    expect(or.textGroups).toHaveLength(2)
  })

  it('parses angle-bracket OR groups', () => {
    const q = parseEverythingQuery('<cat|dog> bird')
    expect(q.textGroups[0]?.length).toBe(2)
    expect(q.textGroups).toHaveLength(2)
    expect(q.advanced).toBe(true)
  })

  it('parses quoted exact phrases', () => {
    const q = parseEverythingQuery('"my file"')
    expect(q.textGroups[0]?.[0]).toEqual({ kind: 'exact', value: 'my file' })
  })

  it('parses size and ext and macros', () => {
    const q = parseEverythingQuery('size:>1mb ext:jpg;png pic:')
    expect(q.size?.op).toBe('gt')
    if (q.size && q.size.op !== 'range') expect(q.size.bytes).toBe(1024 * 1024)
    expect(q.exts).toContain('jpg')
    expect(q.exts).toContain('png')
    expect(q.exts).toContain('webp')
    expect(q.advanced).toBe(true)
  })

  it('parses exclude extensions via !ext:', () => {
    const q = parseEverythingQuery('photo !ext:tmp;bak')
    expect(q.excludeExts).toEqual(['tmp', 'bak'])
    expect(q.notText).toHaveLength(0)
    expect(q.textGroups[0]?.[0]).toMatchObject({ kind: 'substr', value: 'photo' })
  })

  it('parses !pic: macro as excluded extensions', () => {
    const q = parseEverythingQuery('report !pic:')
    expect(q.excludeExts).toContain('jpg')
    expect(q.excludeExts).toContain('png')
  })

  it('parses path drive token and NOT text', () => {
    const q = parseEverythingQuery('d:\\AI !tmp')
    expect(q.pathPrefixes.some((p) => p.toLowerCase().startsWith('d:\\ai'))).toBe(true)
    expect(q.notText.length).toBe(1)
    expect(q.notText[0]).toMatchObject({ kind: 'substr', value: 'tmp' })
  })

  it('parses content: and file:/folder: modifiers', () => {
    const q = parseEverythingQuery('content:hello file:')
    expect(q.content).toBe('hello')
    expect(q.fileOnly).toBe(true)

    const folders = parseEverythingQuery('folder:')
    expect(folders.folderOnly).toBe(true)
  })

  it('parses date modified presets and custom ops', () => {
    const q = parseEverythingQuery('dm:today dm:>2024-01-01')
    expect(q.dates).toHaveLength(2)
    expect(q.dates[0]?.field).toBe('mtime')
    expect(q.dates[1]?.op).toBe('gt')
  })

  it('parses location functions', () => {
    const q = parseEverythingQuery('infolder:Vacation parent:Data path:clip')
    expect(q.infolder).toBe('Vacation')
    expect(q.parentName).toBe('Data')
    expect(q.pathContains).toContain('clip')
  })

  it('parses nopath: and exclude path via nopath function', () => {
    const q = parseEverythingQuery('nopath:node_modules')
    expect(q.excludePathContains).toContain('node_modules')
  })

  it('parses startwith/endwith/len/depth/child/childcount/empty/count', () => {
    const q = parseEverythingQuery(
      'startwith:pre endwith:.txt len:>5 depth:<=2 child:index childcount:>0 empty: count:50'
    )
    expect(q.textGroups.some((g) => g[0]?.kind === 'startwith')).toBe(true)
    expect(q.textGroups.some((g) => g[0]?.kind === 'endwith')).toBe(true)
    expect(q.lenMin).toBe(6)
    expect(q.depthMax).toBe(2)
    expect(q.childName).toBe('index')
    expect(q.childCountMin).toBe(1)
    expect(q.empty).toBe(true)
    expect(q.countLimit).toBe(50)
  })

  it('parses dupe variants and attributes', () => {
    expect(parseEverythingQuery('dupe:').dupe).toBe('name')
    expect(parseEverythingQuery('sizedupe:').dupe).toBe('size')
    expect(parseEverythingQuery('namepartdupe:').dupe).toBe('namepart')
    expect(parseEverythingQuery('attrib:hsra').attrib).toEqual({
      hidden: true,
      system: true,
      readonly: true,
      archive: true
    })
  })

  it('maps bare .ext tokens to name substrings (so .o includes .obj)', () => {
    const q = parseEverythingQuery('.jpg')
    expect(q.textGroups[0]?.[0]).toEqual({ kind: 'substr', value: '.jpg', wholeWord: false })
  })

  it('routes plain file queries through basic name matching (not operators)', () => {
    for (const term of ['annual-report.pdf', 'photo.jpg', 'readme']) {
      const q = parseEverythingQuery(term)
      expect(q.advanced).toBe(false)
      expect(q.textGroups).toEqual([[{ kind: 'substr', value: term, wholeWord: false }]])
    }
    expect(parseEverythingQuery('My Document.docx').textGroups).toEqual([
      [{ kind: 'substr', value: 'My', wholeWord: false }],
      [{ kind: 'substr', value: 'Document.docx', wholeWord: false }]
    ])
    expect(parseEverythingQuery('.jpg').textGroups[0]?.[0]).toEqual({
      kind: 'substr',
      value: '.jpg',
      wholeWord: false
    })
  })

  it('does not match every row when name predicates are missing', () => {
    const q = parseEverythingQuery('readme.txt')
    q.textGroups = []
    expect(
      rowMatchesStructured(row({ path: 'C:\\a\\photo.jpg', name: 'photo.jpg' }), q)
    ).toBe(false)
    expect(
      rowMatchesStructured(row({ path: 'C:\\a\\readme.txt', name: 'readme.txt' }), q)
    ).toBe(false)
  })

  it('still parses explicit operators as advanced', () => {
    expect(parseEverythingQuery('ext:txt').advanced).toBe(true)
    expect(parseEverythingQuery('size:>1mb').advanced).toBe(true)
    expect(parseEverythingQuery('photo !tmp').advanced).toBe(true)
  })

  it('honours parse option defaults for match toggles', () => {
    const q = parseEverythingQuery('ext:txt', { matchPath: true, matchCase: true, wholeWord: true, regex: true })
    expect(q.matchPath).toBe(true)
    expect(q.matchCase).toBe(true)
    expect(q.wholeWord).toBe(true)
    expect(q.regex).toBe(true)
  })

  it('basic filename queries ignore match-path and regex toggles', () => {
    const q = parseEverythingQuery('report.pdf', {
      matchPath: true,
      matchCase: true,
      wholeWord: true,
      regex: true
    })
    expect(q.matchPath).toBe(false)
    expect(q.regex).toBe(false)
    expect(q.matchCase).toBe(true)
    expect(q.wholeWord).toBe(true)
    expect(q.textGroups).toEqual([[{ kind: 'substr', value: 'report.pdf', wholeWord: true }]])
  })
})

describe('matchTextPred and groups', () => {
  it('matches globs, whole word, and regex', () => {
    expect(matchTextPred({ kind: 'glob', value: '*.jpg' }, 'photo.jpg', false)).toBe(true)
    expect(matchTextPred({ kind: 'glob', value: '*.jpg' }, 'photo.png', false)).toBe(false)
    expect(matchTextPred({ kind: 'substr', value: 'cat', wholeWord: true }, 'my cat.jpg', false)).toBe(true)
    expect(matchTextPred({ kind: 'substr', value: 'cat', wholeWord: true }, 'scatter.jpg', false)).toBe(false)
    expect(matchTextPred({ kind: 'regex', source: '^photo\\.', flags: 'i' }, 'photo.jpg', false)).toBe(true)
  })

  it('supports OR text groups', () => {
    const q = parseEverythingQuery('cat|dog')
    expect(matchTextGroups(q.textGroups, 'mydog.jpg', 'C:\\mydog.jpg', false, false)).toBe(true)
    expect(matchTextGroups(q.textGroups, 'bird.jpg', 'C:\\bird.jpg', false, false)).toBe(false)
  })
})

describe('rowMatchesStructured', () => {
  it('matches size and ext include', () => {
    const q = parseEverythingQuery('size:>100 ext:txt')
    expect(rowMatchesStructured(row({ path: 'C:\\a\\b.txt', name: 'b.txt', size: 200 }), q)).toBe(true)
    expect(rowMatchesStructured(row({ path: 'C:\\a\\b.txt', name: 'b.txt', size: 50 }), q)).toBe(false)
    expect(rowMatchesStructured(row({ path: 'C:\\a\\b.jpg', name: 'b.jpg', size: 200 }), q)).toBe(false)
  })

  it('excludes extensions with !ext: only when a name is also given', () => {
    const excludeOnly = parseEverythingQuery('!ext:tmp;bak')
    expect(rowMatchesStructured(row({ path: 'C:\\a\\x.jpg', name: 'x.jpg', size: 1 }), excludeOnly)).toBe(false)

    const q = parseEverythingQuery('x !ext:tmp;bak')
    expect(rowMatchesStructured(row({ path: 'C:\\a\\x.jpg', name: 'x.jpg', size: 1 }), q)).toBe(true)
    expect(rowMatchesStructured(row({ path: 'C:\\a\\x.tmp', name: 'x.tmp', size: 1 }), q)).toBe(false)
    expect(rowMatchesStructured(row({ path: 'C:\\a\\x.bak', name: 'x.bak', size: 1 }), q)).toBe(false)
  })

  it('excludes name/path text with !token', () => {
    const q = parseEverythingQuery('photo !tmp')
    expect(rowMatchesStructured(row({ path: 'C:\\a\\photo.jpg', name: 'photo.jpg', size: 1 }), q)).toBe(true)
    expect(rowMatchesStructured(row({ path: 'C:\\a\\photo.tmp', name: 'photo.tmp', size: 1 }), q)).toBe(false)
  })

  it('respects fileOnly and folderOnly when a name is also given', () => {
    const files = parseEverythingQuery('f file:')
    const folders = parseEverythingQuery('d folder:')
    expect(rowMatchesStructured(row({ path: 'C:\\a\\f.txt', name: 'f.txt' }), files)).toBe(true)
    expect(rowMatchesStructured(row({ path: 'C:\\a\\d', name: 'd', isDir: true }), files)).toBe(false)
    expect(rowMatchesStructured(row({ path: 'C:\\a\\d', name: 'd', isDir: true }), folders)).toBe(true)
    expect(rowMatchesStructured(row({ path: 'C:\\a\\f.txt', name: 'f.txt' }), parseEverythingQuery('file:'))).toBe(
      false
    )
  })

  it('filters by path prefix, contains, and exclude contains', () => {
    const prefix = parseEverythingQuery('C:\\Data\\')
    expect(rowMatchesStructured(row({ path: 'C:\\Data\\x.txt', name: 'x.txt' }), prefix)).toBe(true)
    expect(rowMatchesStructured(row({ path: 'C:\\Other\\x.txt', name: 'x.txt' }), prefix)).toBe(false)

    const contains = parseEverythingQuery('path:Vacation')
    expect(rowMatchesStructured(row({ path: 'C:\\Data\\Vacation\\a.txt', name: 'a.txt' }), contains)).toBe(true)
    expect(rowMatchesStructured(row({ path: 'C:\\Data\\a.txt', name: 'a.txt' }), contains)).toBe(false)

    const exclude = parseEverythingQuery('x nopath:node_modules')
    expect(
      rowMatchesStructured(row({ path: 'C:\\Data\\node_modules\\x.js', name: 'x.js' }), exclude)
    ).toBe(false)
    expect(rowMatchesStructured(row({ path: 'C:\\Data\\x.js', name: 'x.js' }), exclude)).toBe(true)
    expect(
      rowMatchesStructured(row({ path: 'C:\\Data\\x.js', name: 'x.js' }), parseEverythingQuery('nopath:node_modules'))
    ).toBe(false)
  })

  it('filters by infolder and parent', () => {
    const infolder = parseEverythingQuery('infolder:Vacation')
    expect(rowMatchesStructured(row({ path: 'C:\\Data\\Vacation\\a.txt', name: 'a.txt' }), infolder)).toBe(true)
    expect(rowMatchesStructured(row({ path: 'C:\\Data\\a.txt', name: 'a.txt' }), infolder)).toBe(false)

    const parent = parseEverythingQuery('parent:Vacation')
    expect(rowMatchesStructured(row({ path: 'C:\\Data\\Vacation\\a.txt', name: 'a.txt' }), parent)).toBe(true)
    expect(rowMatchesStructured(row({ path: 'C:\\Data\\a.txt', name: 'a.txt' }), parent)).toBe(false)
  })

  it('filters by empty flag and name length', () => {
    const empty = parseEverythingQuery('empty:')
    expect(rowMatchesStructured(row({ path: 'C:\\a\\z', name: 'z', size: 0 }), empty)).toBe(true)
    expect(rowMatchesStructured(row({ path: 'C:\\a\\z', name: 'z', size: 10 }), empty)).toBe(false)

    const len = parseEverythingQuery('len:>5')
    expect(rowMatchesStructured(row({ path: 'C:\\a\\longer', name: 'longer', size: 1 }), len)).toBe(true)
    expect(rowMatchesStructured(row({ path: 'C:\\a\\short', name: 'short', size: 1 }), len)).toBe(false)
  })

  it('filters by depth relative to root prefix', () => {
    const depth = parseEverythingQuery('depth:1')
    expect(
      rowMatchesStructured(row({ path: 'C:\\Data\\photo.jpg', name: 'photo.jpg' }), depth, {
        rootPrefix: 'C:\\Data'
      })
    ).toBe(true)
    expect(
      rowMatchesStructured(row({ path: 'C:\\Data\\Vacation\\clip.mp4', name: 'clip.mp4' }), depth, {
        rootPrefix: 'C:\\Data'
      })
    ).toBe(false)
  })

  it('filters by win32 attributes when attrs present', () => {
    const hidden = parseEverythingQuery('attrib:h')
    expect(
      rowMatchesStructured(row({ path: 'C:\\a\\h.dat', name: 'h.dat', attrs: 0x2 }), hidden)
    ).toBe(true)
    expect(
      rowMatchesStructured(row({ path: 'C:\\a\\n.dat', name: 'n.dat', attrs: 0x0 }), hidden)
    ).toBe(false)
  })

  it('computes depthFromRoot', () => {
    expect(depthFromRoot('C:\\Data\\Vacation\\a.txt', 'C:\\Data')).toBe(2)
    expect(depthFromRoot('C:\\Data\\a.txt', 'C:\\Data')).toBe(1)
  })
})

describe('fixture corpus — shared by indexed post-filter and folder walk', () => {
  it('finds photos while excluding tmp via !ext:', () => {
    expect(fixtureNames('photo !ext:tmp')).toEqual(['photo.jpg'])
  })

  it('includes macro types and can exclude extensions', () => {
    const names = fixtureNames('pic: !ext:jpg')
    expect(names).not.toContain('photo.jpg')
    expect(names).not.toContain('mirror.jpg')
  })

  it('combines infolder with extension filter', () => {
    expect(fixtureNames('infolder:Vacation ext:txt')).toEqual(['notes.txt'])
  })

  it('excludes path segments via nopath:', () => {
    const names = fixtureNames('index nopath:node_modules')
    expect(names).not.toContain('index.js')
  })

  it('treats !!Thumbs.db as a file name, not “match everything except”', () => {
    expect(fixtureNames('!!Thumbs.db')).toEqual(['!!Thumbs.db'])
    expect(fixtureNames('!!Thumbs.db')).not.toContain('photo.jpg')
    expect(fixtureNames('!!Thumbs.db')).not.toContain('Archive')
  })

  it('exclude-only queries match nothing', () => {
    expect(fixtureNames('!tmp')).toEqual([])
    expect(fixtureNames('!ext:jpg')).toEqual([])
    expect(fixtureNames('nopath:Data')).toEqual([])
  })

  it('respects folder scope root prefix for depth', () => {
    expect(fixtureNames('depth:1', {}, 'C:\\Data\\Vacation')).toEqual(['clip.mp4', 'notes.txt'])
  })

  it('basic name queries match only names containing the term', () => {
    expect(fixtureNames('something.txt')).toEqual(['something.txt'])
    expect(fixtureNames('report.pdf')).toEqual(['report.pdf'])
    expect(fixtureNames('readme.txt')).toEqual(['readme.txt'])
    expect(fixtureNames('photo.jpg')).toEqual(['photo.jpg'])
    expect(fixtureNames('readme.txt|notes.txt')).toEqual(['readme.txt', 'notes.txt'])
    expect(fixtureNames('nothing-here.xyz')).toEqual([])
    expect(fixtureNames('report')).toEqual(['report.pdf'])
    // Negative: must not return unrelated decoys (the user-visible bug).
    for (const q of ['something.txt', 'readme.txt', 'report.pdf']) {
      const names = fixtureNames(q)
      expect(names).not.toContain('photo.jpg')
      expect(names).not.toContain('Archive')
      expect(names).not.toContain('Vacation')
    }
  })

  it('indexed scope without root prefix still matches path tokens globally', () => {
    expect(fixtureNames('path:Other', {}, null)).toEqual(['mirror.jpg'])
  })
})
