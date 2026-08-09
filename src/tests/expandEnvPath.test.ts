import { describe, expect, it } from 'vitest'
import { expandWindowsEnvVars } from '../shared/expandEnvPath'

describe('expandWindowsEnvVars', () => {
  const env: Record<string, string> = {
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    USERPROFILE: 'C:\\Users\\me',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)'
  }
  const lookup = (name: string): string | undefined => {
    const hit = env[name] ?? env[name.toUpperCase()]
    if (hit) return hit
    const want = name.toLowerCase()
    for (const [k, v] of Object.entries(env)) {
      if (k.toLowerCase() === want) return v
    }
    return undefined
  }

  it('expands known variables', () => {
    expect(expandWindowsEnvVars('%LOCALAPPDATA%\\Temp', lookup)).toBe(
      'C:\\Users\\me\\AppData\\Local\\Temp'
    )
    expect(expandWindowsEnvVars('%userprofile%', lookup)).toBe('C:\\Users\\me')
  })

  it('expands names with parentheses', () => {
    expect(expandWindowsEnvVars('%ProgramFiles(x86)%\\Foo', lookup)).toBe(
      'C:\\Program Files (x86)\\Foo'
    )
  })

  it('leaves unknown variables intact', () => {
    expect(expandWindowsEnvVars('%NOT_A_REAL_VAR%\\x', lookup)).toBe('%NOT_A_REAL_VAR%\\x')
  })

  it('expands multiple segments', () => {
    expect(expandWindowsEnvVars('%USERPROFILE%\\AppData\\Local', lookup)).toBe(
      'C:\\Users\\me\\AppData\\Local'
    )
  })
})
