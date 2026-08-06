import { describe, expect, it } from 'vitest'

/** Mirror of renderer/lib/rightDrag.isValidDropDest for node-side unit tests. */
function isValidDropDest(paths: string[], dest: string): boolean {
  if (!dest || paths.length === 0) return false
  const d = dest.replace(/\\/g, '/').toLowerCase()
  return !paths.some((p) => {
    const s = p.replace(/\\/g, '/').toLowerCase()
    return s === d || d.startsWith(s.endsWith('/') ? s : s + '/')
  })
}

function isVolumeRootPath(p: string): boolean {
  const n = p.replace(/\//g, '\\').replace(/\\+$/, '')
  return /^[a-zA-Z]:$/i.test(n)
}

describe('isValidDropDest', () => {
  it('rejects dropping onto a dragged folder or inside it', () => {
    expect(isValidDropDest(['C:\\a\\folder'], 'C:\\a\\folder')).toBe(false)
    expect(isValidDropDest(['C:\\a\\folder'], 'C:\\a\\folder\\child')).toBe(false)
  })
  it('allows dropping onto a sibling or other folder', () => {
    expect(isValidDropDest(['C:\\a\\file.txt'], 'C:\\a\\other')).toBe(true)
    expect(isValidDropDest(['C:\\a\\file.txt'], 'C:\\b')).toBe(true)
  })
})

describe('isVolumeRootPath', () => {
  it('detects drive roots', () => {
    expect(isVolumeRootPath('C:\\')).toBe(true)
    expect(isVolumeRootPath('C:')).toBe(true)
    expect(isVolumeRootPath('d:/')).toBe(true)
    expect(isVolumeRootPath('C:\\Users')).toBe(false)
  })
})
