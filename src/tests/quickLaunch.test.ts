import { describe, expect, it } from 'vitest'
import {
  isQuickLaunchPath,
  isShortcutLaunchPath,
  mergeQuickLaunchPaths,
  quickLaunchNameFromPath,
  sanitizeQuickLaunch,
  splitLaunchArgs
} from '../shared/schemas/quickLaunch'

describe('quick launch helpers', () => {
  it('names an app from the exe basename', () => {
    expect(quickLaunchNameFromPath('C:\\Program Files\\Adobe\\Photoshop.exe')).toBe('Photoshop')
    expect(quickLaunchNameFromPath('%LocalAppData%\\Programs\\Microsoft VS Code\\Code.exe')).toBe(
      'Code'
    )
    expect(quickLaunchNameFromPath('D:\\tools\\devenv.lnk')).toBe('devenv')
  })

  it('accepts program and shortcut extensions', () => {
    expect(isQuickLaunchPath('C:\\Windows\\notepad.exe')).toBe(true)
    expect(isQuickLaunchPath('D:\\Photoshop.lnk')).toBe(true)
    expect(isQuickLaunchPath('D:\\photo.png')).toBe(false)
    expect(isShortcutLaunchPath('D:\\Photoshop.lnk')).toBe(true)
    expect(isShortcutLaunchPath('C:\\Windows\\notepad.exe')).toBe(false)
  })

  it('splits quoted arguments without a shell', () => {
    expect(splitLaunchArgs('')).toEqual([])
    expect(splitLaunchArgs('--safe "C:\\My Files\\x"')).toEqual(['--safe', 'C:\\My Files\\x'])
  })

  it('drops invalid catalog rows and caps the list', () => {
    const rows = sanitizeQuickLaunch([
      { id: 'ql_a1_bbbb', name: 'PS', path: 'C:\\Photoshop.exe', args: '', iconKind: 'shell' },
      { id: 'no', name: 'Bad', path: 'C:\\x.exe' },
      {
        id: 'ql_a1_bbbb',
        name: 'Dup',
        path: 'C:\\other.exe',
        args: '',
        iconKind: 'shell'
      }
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('PS')
  })

  it('merges dropped program paths and skips duplicates', () => {
    const first = mergeQuickLaunchPaths([], ['C:\\Windows\\notepad.exe', 'D:\\photo.png'])
    expect(first.added).toBe(1)
    expect(first.next[0]?.name).toBe('notepad')
    const again = mergeQuickLaunchPaths(first.next, ['C:\\Windows\\NOTEPAD.EXE', 'D:\\Code.lnk'])
    expect(again.added).toBe(1)
    expect(again.next).toHaveLength(2)
    expect(again.next[1]?.name).toBe('Code')
  })

  it('falls back to the shell icon when a custom icon has no id', () => {
    const rows = sanitizeQuickLaunch([
      {
        id: 'ql_b2_cccc',
        name: 'VS',
        path: 'C:\\devenv.exe',
        args: '',
        iconKind: 'custom'
      }
    ])
    expect(rows[0]?.iconKind).toBe('shell')
    expect(rows[0]?.show).toBe('icon')
  })

  it('falls back to the shell icon when a Lucide icon has no name', () => {
    const rows = sanitizeQuickLaunch([
      {
        id: 'ql_c3_dddd',
        name: 'Notes',
        path: 'C:\\notes.exe',
        args: '',
        iconKind: 'lucide'
      }
    ])
    expect(rows[0]?.iconKind).toBe('shell')
  })

  it('defaults iconSizePx and keeps Lucide name/color and show=both', () => {
    const rows = sanitizeQuickLaunch([
      {
        id: 'ql_d4_eeee',
        name: 'Code',
        path: 'C:\\Code.exe',
        args: '',
        show: 'both',
        iconKind: 'lucide',
        lucideName: 'Code',
        lucideColor: '#34d399'
      }
    ])
    expect(rows[0]).toMatchObject({
      show: 'both',
      iconSizePx: 24,
      iconKind: 'lucide',
      lucideName: 'Code',
      lucideColor: '#34d399'
    })
  })

  it('clamps per-pin iconSizePx', () => {
    const rows = sanitizeQuickLaunch([
      {
        id: 'ql_e5_ffff',
        name: 'Big',
        path: 'C:\\big.exe',
        args: '',
        show: 'icon',
        iconSizePx: 99,
        iconKind: 'shell'
      }
    ])
    expect(rows[0]?.iconSizePx).toBe(24)
  })
})
