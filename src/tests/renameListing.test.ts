import { describe, expect, it } from 'vitest'
import type { DirEntry } from '../shared/schemas/fs'
import {
  patchDirEntriesForRename,
  renameDestOccupied,
  renameShouldFollow,
  rewritePathAfterRename
} from '../renderer/lib/renameListing'

function file(name: string, dir = '\\\\nas\\media'): DirEntry {
  return {
    name,
    path: `${dir}\\${name}`,
    kind: 'file',
    size: 1,
    mtimeMs: 1,
    birthtimeMs: 1,
    ext: name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '',
    isHidden: false
  }
}

describe('rewritePathAfterRename', () => {
  it('rewrites the item and paths under it', () => {
    expect(rewritePathAfterRename('D:\\a\\old', 'D:\\a\\old', 'D:\\a\\new')).toBe('D:\\a\\new')
    expect(rewritePathAfterRename('D:\\a\\old\\x', 'D:\\a\\old', 'D:\\a\\new')).toBe('D:\\a\\new\\x')
    expect(rewritePathAfterRename('D:\\a\\other', 'D:\\a\\old', 'D:\\a\\new')).toBe('D:\\a\\other')
  })
})

describe('renameDestOccupied', () => {
  it('is true when another sibling already has the dest path', () => {
    const dir = 'C:\\lib'
    const test = { path: `${dir}\\Test` }
    const test2 = { path: `${dir}\\Test2` }
    expect(renameDestOccupied([test, test2], test2.path, test.path)).toBe(true)
    expect(renameDestOccupied([test, test2], test2.path, `${dir}\\Test3`)).toBe(false)
    expect(renameDestOccupied([test], test.path, test.path)).toBe(false)
  })
})

describe('patchDirEntriesForRename', () => {
  it('does not alias two folders onto one path when the new name exists', () => {
    const dir = 'C:\\lib'
    const test = { ...file('Test', dir), kind: 'dir' as const, ext: '' }
    const test2 = { ...file('Test2', dir), kind: 'dir' as const, ext: '' }
    const next = patchDirEntriesForRename([test, test2], test2.path, test.path, 'Test')
    expect(next.map((e) => e.name).sort()).toEqual(['Test', 'Test'])
    expect(next.map((e) => e.path).sort()).toEqual([test.path, test2.path].sort())
    const source = next.find((e) => e.path === test2.path)
    expect(source?.name).toBe('Test')
    const existing = next.find((e) => e.path === test.path)
    expect(existing?.name).toBe('Test')
    expect(existing?.path).toBe(test.path)
  })

  it('shows the new name immediately', () => {
    const entries = [file('Adventureland (2009) [Part 1].avi'), file('Adventureland (2009) [Part 2].avi')]
    const from = entries[0]!.path
    const to = '\\\\nas\\media\\Adventureland (2009).avi'
    const next = patchDirEntriesForRename(entries, from, to, 'Adventureland (2009).avi')
    expect(next[0]!.name).toBe('Adventureland (2009).avi')
    expect(next[0]!.path).toBe(to)
    expect(next[1]!.name).toBe('Adventureland (2009) [Part 2].avi')
  })
})

describe('renameShouldFollow', () => {
  const paths = ['C:\\lib\\old.avi', 'C:\\lib\\new.avi']

  it('follows when the user is still on the renamed item', () => {
    expect(
      renameShouldFollow({
        renamingPath: null,
        focusedPath: 'C:\\lib\\new.avi',
        selected: ['C:\\lib\\new.avi'],
        paths
      })
    ).toBe(true)
  })

  it('does not steal focus when another rename is open', () => {
    expect(
      renameShouldFollow({
        renamingPath: 'C:\\lib\\other.avi',
        focusedPath: 'C:\\lib\\other.avi',
        selected: ['C:\\lib\\other.avi'],
        paths
      })
    ).toBe(false)
  })

  it('does not steal focus when the user selected something else', () => {
    expect(
      renameShouldFollow({
        renamingPath: null,
        focusedPath: 'C:\\lib\\other.avi',
        selected: ['C:\\lib\\other.avi'],
        paths
      })
    ).toBe(false)
  })

  it('does not follow after Back→Arrow Down moved off the renamed file', () => {
    // Same contract as historyLateListingAction: late NAS work must not jump.
    expect(
      renameShouldFollow({
        renamingPath: null,
        focusedPath: 'C:\\lib\\next.avi',
        selected: ['C:\\lib\\next.avi'],
        paths
      })
    ).toBe(false)
  })

  it('follows when selection is empty but focus is still ours', () => {
    expect(
      renameShouldFollow({
        renamingPath: null,
        focusedPath: 'C:\\lib\\new.avi',
        selected: [],
        paths
      })
    ).toBe(true)
  })
})

describe('rename then sort', () => {
  it('places the new name where A–Z sort expects it', () => {
    const dir = 'C:\\lib'
    const entries = [
      file('Alpha', dir),
      file('New folder', dir),
      file('Zulu', dir)
    ].map((e) => ({ ...e, kind: 'dir' as const, ext: '' }))
    const from = `${dir}\\New folder`
    const patched = patchDirEntriesForRename(entries, from, `${dir}\\Babylon 5`, 'Babylon 5')
    const names = [...patched]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
      .map((e) => e.name)
    expect(names).toEqual(['Alpha', 'Babylon 5', 'Zulu'])
  })
})
