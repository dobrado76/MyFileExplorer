import { describe, expect, it } from 'vitest'
import { classifyShellTarget } from '../shared/shellFolderRedirect'

describe('classifyShellTarget', () => {
  it('accepts drive and UNC paths as directory candidates', () => {
    expect(classifyShellTarget('D:\\Projects')).toBe('directory')
    expect(classifyShellTarget('D:')).toBe('directory')
    expect(classifyShellTarget('\\\\server\\share\\folder')).toBe('directory')
    expect(classifyShellTarget('\\\\server\\share')).toBe('directory')
  })

  it('rejects shell namespace identifiers', () => {
    expect(classifyShellTarget('::{20D04FE0-3AEA-1069-A2D8-08002B30309D}')).toBe('unsupported')
    expect(classifyShellTarget('shell:Downloads')).toBe('unsupported')
    expect(classifyShellTarget('shell:RecycleBinFolder')).toBe('unsupported')
  })

  it('rejects empty and non-path strings', () => {
    expect(classifyShellTarget('')).toBe('unsupported')
    expect(classifyShellTarget('   ')).toBe('unsupported')
    expect(classifyShellTarget('not-a-path')).toBe('unsupported')
  })
})
