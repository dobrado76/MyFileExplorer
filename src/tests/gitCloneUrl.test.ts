import { describe, expect, it } from 'vitest'
import {
  extractGitCloneUrl,
  folderNameFromGitUrl,
  isValidCloneFolderName,
  looksLikeGitCloneUrl,
  sanitizeFolderName
} from '../shared/gitCloneUrl'
import { gitCloneRequestSchema } from '../shared/schemas/git'

describe('gitCloneUrl helpers', () => {
  it('detects common clone URLs', () => {
    expect(looksLikeGitCloneUrl('https://github.com/a/b.git')).toBe(true)
    expect(looksLikeGitCloneUrl('https://github.com/a/b')).toBe(true)
    expect(looksLikeGitCloneUrl('git@github.com:a/b.git')).toBe(true)
    expect(looksLikeGitCloneUrl('not a url')).toBe(false)
    expect(looksLikeGitCloneUrl('https://example.com')).toBe(false)
  })

  it('extracts URL from clipboard text', () => {
    expect(extractGitCloneUrl('  https://github.com/org/repo.git  ')).toBe(
      'https://github.com/org/repo.git'
    )
    expect(extractGitCloneUrl('hello\nhttps://github.com/org/repo.git\n')).toBe(
      'https://github.com/org/repo.git'
    )
    expect(extractGitCloneUrl('random text')).toBeNull()
  })

  it('suggests folder names from URLs', () => {
    expect(folderNameFromGitUrl('https://github.com/org/MyFileExplorer.git')).toBe(
      'MyFileExplorer'
    )
    expect(folderNameFromGitUrl('git@github.com:org/MyFileExplorer.git')).toBe('MyFileExplorer')
    expect(folderNameFromGitUrl('https://github.com/org/MyFileExplorer/')).toBe('MyFileExplorer')
  })

  it('validates folder names', () => {
    expect(isValidCloneFolderName('MyRepo')).toBe(true)
    expect(isValidCloneFolderName('bad/name')).toBe(false)
    expect(isValidCloneFolderName('a:b')).toBe(false)
    expect(isValidCloneFolderName('')).toBe(false)
    expect(sanitizeFolderName('a/b:c')).toBe('abc')
  })

  it('accepts clone request schema', () => {
    const parsed = gitCloneRequestSchema.parse({
      parentDir: 'C:/Projects',
      folderName: 'MyRepo',
      url: 'https://github.com/a/b.git'
    })
    expect(parsed.folderName).toBe('MyRepo')
  })
})
