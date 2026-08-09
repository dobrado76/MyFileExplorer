import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildArchiveTreeFromZip } from '../main/preview/zipArchive'

describe('buildArchiveTreeFromZip', () => {
  it('nests folders and files with dirs first', async () => {
    const zip = new JSZip()
    zip.file('readme.txt', 'hi')
    zip.file('src/main.ts', 'export {}')
    zip.file('src/lib/util.ts', 'export const x = 1')
    zip.folder('empty')

    const { tree, fileCount, truncated } = buildArchiveTreeFromZip(zip)
    expect(truncated).toBe(false)
    expect(fileCount).toBe(3)
    expect(tree.map((n) => n.name)).toEqual(['empty', 'src', 'readme.txt'])
    const src = tree.find((n) => n.name === 'src')
    expect(src?.kind).toBe('dir')
    expect(src?.children?.map((c) => c.name)).toEqual(['lib', 'main.ts'])
  })

  it('skips zip-slip style entry names', () => {
    const zip = new JSZip()
    zip.file('ok.txt', 'a')
    zip.file('../evil.txt', 'b')
    const { tree, fileCount } = buildArchiveTreeFromZip(zip)
    expect(fileCount).toBe(1)
    expect(tree.every((n) => !n.name.includes('..'))).toBe(true)
  })
})
