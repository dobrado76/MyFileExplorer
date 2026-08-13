import { describe, expect, it } from 'vitest'
import {
  buildCommandMenuRows,
  commandMatches,
  expandArgsTemplate,
  normalizeExtensions,
  parseCommandLabelSegments,
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

describe('buildCommandMenuRows', () => {
  it('groups commands sharing a label prefix into one submenu', () => {
    const cmds: ContextMenuCommand[] = [
      { ...base, id: 'a', label: 'My Custom Options \\ Option 1' },
      { ...base, id: 'b', label: 'My Custom Options \\ Option 2' },
      { ...base, id: 'c', label: 'Standalone' }
    ]
    const rows = buildCommandMenuRows(cmds, () => {})
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ type: 'submenu', label: 'My Custom Options' })
    expect(rows[0]?.type === 'submenu' && rows[0].items.map((i) => i.label)).toEqual([
      'Option 1',
      'Option 2'
    ])
    expect(rows[1]).toMatchObject({ type: 'item', label: 'Standalone' })
  })

  it('supports nested submenu paths', () => {
    const cmds: ContextMenuCommand[] = [
      { ...base, id: 'a', label: 'Tools \\ Editors \\ VS Code' }
    ]
    const rows = buildCommandMenuRows(cmds, () => {})
    expect(rows[0]?.type).toBe('submenu')
    if (rows[0]?.type === 'submenu') {
      expect(rows[0].label).toBe('Tools')
      expect(rows[0].items[0]?.label).toBe('Editors')
      expect(rows[0].items[0]?.items?.[0]?.label).toBe('VS Code')
    }
  })
})

describe('parseCommandLabelSegments', () => {
  it('splits on backslash and trims', () => {
    expect(parseCommandLabelSegments('My Custom Options \\ Option 1')).toEqual([
      'My Custom Options',
      'Option 1'
    ])
    expect(parseCommandLabelSegments('Flat label')).toEqual(['Flat label'])
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
