import { describe, expect, it } from 'vitest'
import {
  commandMatches,
  expandArgsTemplate,
  normalizeExtensions,
  type ContextMenuCommand
} from '../shared/contextMenuCommands'

const base: ContextMenuCommand = {
  id: '1',
  label: 'Test',
  enabled: true,
  executable: 'C:\\app.exe',
  argsTemplate: '{path}',
  match: { type: 'all' }
}

describe('normalizeExtensions', () => {
  it('strips dots, lowercases, dedupes', () => {
    expect(normalizeExtensions('.JPG, png;PSD png')).toEqual(['jpg', 'png', 'psd'])
  })
})

describe('commandMatches', () => {
  it('requires enabled and non-empty paths', () => {
    expect(commandMatches({ ...base, enabled: false }, ['C:\\a.txt'], 'file')).toBe(false)
    expect(commandMatches(base, [], 'file')).toBe(false)
  })

  it('all files match', () => {
    expect(commandMatches(base, ['C:\\a.txt', 'C:\\b.png'], 'file')).toBe(true)
  })

  it('extensions all-or-nothing', () => {
    const cmd = {
      ...base,
      match: { type: 'extensions' as const, extensions: ['jpg', 'png'] }
    }
    expect(commandMatches(cmd, ['C:\\a.jpg', 'C:\\b.PNG'], 'file')).toBe(true)
    expect(commandMatches(cmd, ['C:\\a.jpg', 'C:\\b.gif'], 'file')).toBe(false)
  })

  it('folders ignore extension match lists', () => {
    expect(
      commandMatches(
        { ...base, match: { type: 'extensions', extensions: ['jpg'] } },
        ['C:\\folder'],
        'folder'
      )
    ).toBe(false)
    expect(commandMatches(base, ['C:\\folder'], 'folder')).toBe(true)
  })
})

describe('expandArgsTemplate', () => {
  it('defaults empty template to first path', () => {
    expect(expandArgsTemplate('', ['C:\\a\\b.txt'])).toEqual(['C:\\a\\b.txt'])
  })

  it('expands scalar tokens from first path', () => {
    expect(expandArgsTemplate('{path}', ['C:\\a\\b.txt', 'C:\\c\\d.txt'])).toEqual([
      'C:\\a\\b.txt'
    ])
    expect(expandArgsTemplate('{name} {dir}', ['C:\\a\\b.txt'])).toEqual([
      'b.txt',
      'C:\\a'
    ])
  })

  it('expands {paths} to one argv per path', () => {
    expect(expandArgsTemplate('{paths}', ['C:\\a', 'C:\\b'])).toEqual(['C:\\a', 'C:\\b'])
    expect(expandArgsTemplate('--files {paths}', ['C:\\a', 'C:\\b'])).toEqual([
      '--files',
      'C:\\a',
      'C:\\b'
    ])
  })

  it('keeps quoted literals', () => {
    expect(expandArgsTemplate('"--profile" "{path}"', ['C:\\a b\\x.txt'])).toEqual([
      '--profile',
      'C:\\a b\\x.txt'
    ])
  })

  it('maps %1 / %* like Windows shell verbs', () => {
    expect(expandArgsTemplate('%1', ['C:\\folder'])).toEqual(['C:\\folder'])
    expect(expandArgsTemplate('%*', ['C:\\a', 'C:\\b'])).toEqual(['C:\\a', 'C:\\b'])
  })
})
