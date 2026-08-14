import { describe, expect, it } from 'vitest'
import { parseEverythingQuery, rowMatchesStructured } from '../main/search/everythingQuery'
import { buildSearchQuery, defaultPowerSearchState } from '@shared/searchBuilder'
import { fixtureNames, SEARCH_FIXTURES } from './searchFixtures'

function powerSearchNames(state: Parameters<typeof buildSearchQuery>[0]): string[] {
  const query = buildSearchQuery(state)
  const q = parseEverythingQuery(query)
  return SEARCH_FIXTURES.filter((row) => rowMatchesStructured(row, q, { rootPrefix: 'C:\\Data' })).map(
    (r) => r.name
  )
}

describe('buildSearchQuery', () => {
  it('combines terms, macros, and filters', () => {
    const q = buildSearchQuery({
      ...defaultPowerSearchState(),
      terms: 'vacation photos',
      types: ['pic'],
      dateModified: 'thisweek',
      sizePreset: 'custom',
      sizeCustom: '>5mb',
      inFolder: 'Trips\\2024'
    })
    expect(q).toContain('pic:')
    expect(q).toContain('vacation')
    expect(q).toContain('photos')
    expect(q).toContain('dm:thisweek')
    expect(q).toContain('size:>5mb')
    expect(q).toContain('infolder:')
  })

  it('adds exclude text tokens', () => {
    const q = buildSearchQuery({
      ...defaultPowerSearchState(),
      exclude: 'tmp backup'
    })
    expect(q).toContain('!tmp')
    expect(q).toContain('!backup')
  })

  it('adds exclude extension tokens via !ext:', () => {
    const q = buildSearchQuery({
      ...defaultPowerSearchState(),
      excludeExtensions: 'tmp;bak'
    })
    expect(q).toContain('!ext:tmp;bak')
    const parsed = parseEverythingQuery(q)
    expect(parsed.excludeExts).toEqual(['tmp', 'bak'])
  })

  it('maps all major Power Search fields to parseable query', () => {
    const q = buildSearchQuery({
      ...defaultPowerSearchState(),
      terms: 'report',
      exclude: 'draft',
      excludeExtensions: 'tmp',
      itemKind: 'file',
      types: ['doc'],
      extensions: 'pdf;docx',
      sizePreset: 'large',
      dateModified: 'today',
      inFolder: 'Work',
      parentName: 'Projects',
      pathContains: '2024',
      pathPrefix: 'D:\\',
      startsWith: 'Q',
      endsWith: 'final',
      attributes: ['h', 'r'],
      emptyOnly: true,
      content: 'budget',
      dupe: 'name',
      childName: 'readme',
      depth: '<=3'
    })
    const parsed = parseEverythingQuery(q)
    expect(parsed.fileOnly).toBe(true)
    expect(parsed.exts).toContain('pdf')
    expect(parsed.excludeExts).toContain('tmp')
    expect(parsed.notText.some((t) => t.kind === 'substr' && t.value === 'draft')).toBe(true)
    expect(parsed.size?.op).toBe('range')
    expect(parsed.dates.length).toBeGreaterThan(0)
    expect(parsed.infolder).toBe('Work')
    expect(parsed.parentName).toBe('Projects')
    expect(parsed.pathContains).toContain('2024')
    expect(parsed.pathPrefixes.some((p) => p.startsWith('D:\\'))).toBe(true)
    expect(parsed.attrib?.hidden).toBe(true)
    expect(parsed.empty).toBe(true)
    expect(parsed.content).toBe('budget')
    expect(parsed.dupe).toBe('name')
    expect(parsed.childName).toBe('readme')
    expect(parsed.depthMax).toBe(3)
  })
})

describe('Power Search → query → match pipeline', () => {
  it('exclude extensions removes tmp files but keeps jpg', () => {
    expect(
      powerSearchNames({
        ...defaultPowerSearchState(),
        terms: 'photo',
        excludeExtensions: 'tmp'
      })
    ).toEqual(['photo.jpg'])
  })

  it('include extensions and exclude extensions compose', () => {
    const names = powerSearchNames({
      ...defaultPowerSearchState(),
      extensions: 'txt',
      excludeExtensions: 'bak'
    })
    expect(names).toContain('readme.txt')
    expect(names).toContain('notes.txt')
    expect(names).not.toContain('backup.bak')
  })

  it('type macro with folder restriction', () => {
    const names = powerSearchNames({
      ...defaultPowerSearchState(),
      types: ['video'],
      inFolder: 'Vacation'
    })
    expect(names).toEqual(['clip.mp4'])
  })

  it('matches fixtureNames for folder-scoped walk simulation', () => {
    const built = buildSearchQuery({
      ...defaultPowerSearchState(),
      excludeExtensions: 'txt;tmp',
      itemKind: 'file',
      pathPrefix: 'C:\\Data'
    })
    expect(fixtureNames(built, {}, 'C:\\Data').sort()).toEqual(
      ['!!Thumbs.db', 'annual-summary.pdf', 'backup.bak', 'clip.mp4', 'index.js', 'photo.jpg', 'hidden.dat', 'report.pdf'].sort()
    )
  })
})
