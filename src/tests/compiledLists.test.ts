import { describe, expect, it } from 'vitest'
import {
  isCompiledListRefPath,
  lastListHasPositiveCounts,
  parseDatImageLines,
  parseLastListText,
  parseTxtBodyLines,
  parseTxtFolderLines,
  sanitizeCompiledName,
  serializeLastList
} from '../shared/slideshow/compiledLists'

describe('compiledLists helpers', () => {
  it('sanitizes names', () => {
    expect(sanitizeCompiledName('A/B:C')).toBe('A_B_C')
    expect(sanitizeCompiledName('  ')).toBe('List')
  })

  it('parses and serializes last list lines', () => {
    const text = `C:\\a\\x.dat|=>2\n\n# comment\nD:\\b\\y.txt|=>0\nE:\\c\\z.dat|=>1\n`
    const lines = parseLastListText(text)
    expect(lines).toEqual([
      { datPath: 'C:\\a\\x.dat', count: 2 },
      { datPath: 'D:\\b\\y.txt', count: 0 },
      { datPath: 'E:\\c\\z.dat', count: 1 }
    ])
    expect(serializeLastList(lines)).toBe('C:\\a\\x.dat|=>2\nE:\\c\\z.dat|=>1')
    expect(lastListHasPositiveCounts(lines)).toBe(true)
  })

  it('parses .dat image lines and .txt folder lines', () => {
    expect(parseDatImageLines('C:\\a\\1.jpg\n\nC:\\b\\2.png\n')).toEqual([
      'C:\\a\\1.jpg',
      'C:\\b\\2.png'
    ])
    expect(parseTxtFolderLines('C:\\photos\nD:\\more |=> 3\n')).toEqual([
      { folder: 'C:\\photos', count: 1 },
      { folder: 'D:\\more', count: 3 }
    ])
  })

  it('detects list refs vs folders in .txt body', () => {
    expect(isCompiledListRefPath('C:\\Lists\\Me.dat')).toBe(true)
    expect(isCompiledListRefPath('C:\\Lists\\combo.TXT')).toBe(true)
    expect(isCompiledListRefPath('C:\\photos')).toBe(false)

    const rows = parseTxtBodyLines(
      [
        'C:\\Documents\\Lists\\All-Faces\\Me.dat |=> 3',
        'C:\\Documents\\Lists\\All-Faces\\MyWife.dat |=> 1',
        'C:\\Documents\\Lists\\All-NoFaces\\MyCat.dat |=> 1',
        'C:\\Documents\\Lists\\All-NoFaces\\Friends.dat |=> 1',
        'C:\\photos\\vacation',
        'D:\\more |=> 2',
        '# comment',
        ''
      ].join('\n')
    )
    expect(rows).toEqual([
      { path: 'C:\\Documents\\Lists\\All-Faces\\Me.dat', count: 3, kind: 'list' },
      { path: 'C:\\Documents\\Lists\\All-Faces\\MyWife.dat', count: 1, kind: 'list' },
      { path: 'C:\\Documents\\Lists\\All-NoFaces\\MyCat.dat', count: 1, kind: 'list' },
      { path: 'C:\\Documents\\Lists\\All-NoFaces\\Friends.dat', count: 1, kind: 'list' },
      { path: 'C:\\photos\\vacation', count: 1, kind: 'folder' },
      { path: 'D:\\more', count: 2, kind: 'folder' }
    ])
  })
})

describe('validateCompiledLists', () => {
  it('reports missing folders and nested list refs', async () => {
    const os = await import('node:os')
    const fsp = await import('node:fs/promises')
    const path = await import('node:path')
    const { validateCompiledLists } = await import('../main/slideshow/compiledLists')

    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-validate-lists-'))
    const cat = path.join(root, 'Cat')
    await fsp.mkdir(cat, { recursive: true })
    const realFolder = path.join(root, 'RealPhotos')
    await fsp.mkdir(realFolder, { recursive: true })
    const nestedOk = path.join(cat, 'ok.dat')
    await fsp.writeFile(nestedOk, `${realFolder}\n`, 'utf8')

    const brokenDat = path.join(cat, 'broken.dat')
    await fsp.writeFile(
      brokenDat,
      [`${path.join(root, 'NoSuchFolder')}`, `${path.join(cat, 'missing.dat')}|=>2`, `${realFolder}`].join(
        '\n'
      ),
      'utf8'
    )

    const brokenTxt = path.join(cat, 'combo.txt')
    await fsp.writeFile(
      brokenTxt,
      [`${path.join(root, 'AlsoMissing')}`, `${path.join(cat, 'gone.txt')}`].join('\n'),
      'utf8'
    )

    try {
      const res = await validateCompiledLists(root)
      expect(res.checkedLists).toBe(3)
      expect(res.ok).toBe(false)
      const kinds = res.issues.map((i) => i.kind).sort()
      expect(kinds).toContain('missing-folder')
      expect(kinds).toContain('missing-list')
      expect(res.issues.some((i) => i.refPath?.toLowerCase().includes('nosuchfolder'))).toBe(true)
      expect(res.issues.some((i) => i.refPath?.toLowerCase().includes('missing.dat'))).toBe(true)
      expect(res.issues.some((i) => i.refPath?.toLowerCase().includes('gone.txt'))).toBe(true)
      expect(res.issues.some((i) => i.refPath?.toLowerCase().includes('alsomissing'))).toBe(true)
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })
})
