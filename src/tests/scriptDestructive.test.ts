import { describe, expect, it } from 'vitest'
import { looksDestructive, redactPathsInText, scanDestructiveSource } from '../shared/scriptDestructive'

describe('destructive heuristic', () => {
  it('flags common delete APIs', () => {
    expect(scanDestructiveSource('os.remove(p)')).toContain('os.remove')
    expect(scanDestructiveSource('Remove-Item -Recurse $root')).toContain('Remove-Item')
    expect(scanDestructiveSource('rm -rf /tmp/x')).toContain('rm -r')
    expect(scanDestructiveSource('del /q file.txt')).toContain('del')
    expect(looksDestructive('print("hello")')).toBe(false)
  })

  it('redacts windows and unc paths', () => {
    const t = redactPathsInText('failed C:\\Users\\sam\\file.txt and \\\\NAS\\share\\a')
    expect(t).not.toContain('Users\\sam')
    expect(t).toContain('<path>')
    expect(t).toContain('<unc-path>')
  })
})
