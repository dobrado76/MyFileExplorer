import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { listDirectoryWin32 } from '../main/fs/listWin32'

describe.skipIf(process.platform !== 'win32')('listDirectoryWin32', () => {
  it('lists the temp directory', () => {
    const dir = os.tmpdir()
    const entries = listDirectoryWin32(dir, true)
    expect(entries).not.toBeNull()
    expect(Array.isArray(entries)).toBe(true)
    // Sanity: every entry path is under dir and has a name.
    for (const e of entries!.slice(0, 20)) {
      expect(e.name.length).toBeGreaterThan(0)
      expect(e.path.toLowerCase().startsWith(path.resolve(dir).toLowerCase())).toBe(true)
      expect(typeof e.mtimeMs).toBe('number')
      expect(typeof e.size).toBe('number')
    }
  })
})
