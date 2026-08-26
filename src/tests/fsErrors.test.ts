import { describe, expect, it } from 'vitest'
import { AppError } from '../shared/result'
import { formatLockingProcesses } from '../main/fs/lockers'

describe('formatLockingProcesses', () => {
  it('formats name and pid lines', () => {
    expect(
      formatLockingProcesses([
        { pid: 12, name: 'notepad.exe' },
        { pid: 34, name: 'Code' }
      ])
    ).toBe('notepad.exe (PID 12)\nCode (PID 34)')
  })

  it('returns empty for no lockers', () => {
    expect(formatLockingProcesses([])).toBe('')
  })
})

describe('AppError remediation envelope', () => {
  it('carries remediation for the UI dialog', () => {
    const e = new AppError('busy', 'locked', 'Close the app')
    expect(e.remediation).toBe('Close the app')
  })

  it('carries structured lockers on the error', () => {
    const lockers = [{ pid: 42, name: 'notepad.exe' }]
    const e = new AppError('busy', 'locked', 'End the task', 'C:\\a.txt', lockers)
    expect(e.lockers).toEqual(lockers)
    expect(e.path).toBe('C:\\a.txt')
  })
})

describe('isProtectedLocker', () => {
  it('protects System and Explorer', async () => {
    const { isProtectedLocker } = await import('../main/fs/lockers')
    expect(isProtectedLocker({ pid: 4, name: 'System' })).toBe(true)
    expect(isProtectedLocker({ pid: 1234, name: 'explorer.exe' })).toBe(true)
    expect(isProtectedLocker({ pid: 1234, name: 'notepad.exe' })).toBe(false)
  })
})
