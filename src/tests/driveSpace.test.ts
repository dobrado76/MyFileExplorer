import { describe, expect, it } from 'vitest'
import {
  driveInfoForPath,
  driveSpaceIsLow,
  driveSpaceIsSafe,
  formatAllDrivesSpace,
  formatDriveSpaceLine,
  formatFreeOfTotal,
  freePercent,
  usedBytesOf
} from '../shared/driveSpace'
import type { DriveInfo } from '../shared/schemas/fs'

const c: DriveInfo = {
  path: 'C:\\',
  label: 'C:',
  volumeName: '',
  driveType: 'fixed',
  totalBytes: 500 * 1024 * 1024 * 1024,
  freeBytes: 120 * 1024 * 1024 * 1024
}

const d: DriveInfo = {
  path: 'D:\\',
  label: 'D:',
  volumeName: 'Games',
  driveType: 'fixed',
  totalBytes: 100 * 1024 * 1024 * 1024,
  freeBytes: 8 * 1024 * 1024 * 1024
}

describe('formatFreeOfTotal', () => {
  it('includes free percent', () => {
    expect(formatFreeOfTotal(c.freeBytes!, c.totalBytes!)).toBe('120 GB free of 500 GB (24%)')
    expect(freePercent(0, 100)).toBe(0)
    expect(freePercent(100, 100)).toBe(100)
  })
})

describe('formatDriveSpaceLine', () => {
  it('prefixes the letter', () => {
    expect(formatDriveSpaceLine(c)).toBe('C: 120 GB free of 500 GB (24%)')
  })

  it('labels offline letters instead of hiding them', () => {
    expect(formatDriveSpaceLine({ path: 'Z:\\', label: 'Z:', volumeName: '', offline: true })).toBe(
      'Z: Disconnected'
    )
  })

  it('skips online drives without sizes', () => {
    expect(
      formatDriveSpaceLine({ path: 'Z:\\', label: 'Z:', volumeName: '', driveType: 'remote' })
    ).toBeNull()
  })
})

describe('formatAllDrivesSpace', () => {
  it('joins online volumes and disconnected letters', () => {
    expect(
      formatAllDrivesSpace([
        c,
        d,
        { path: 'Z:\\', label: 'Z:', volumeName: '', offline: true, driveType: 'remote' }
      ])
    ).toBe('C: 120 GB free of 500 GB (24%)  ·  D: 8.0 GB free of 100 GB (8%)  ·  Z: Disconnected')
  })
})

describe('driveSpaceIsSafe', () => {
  it('skips offline and remote so a dead map cannot block the list', () => {
    expect(driveSpaceIsSafe({ driveType: 'fixed' })).toBe(true)
    expect(driveSpaceIsSafe({ driveType: 'remote' })).toBe(false)
    expect(driveSpaceIsSafe({ driveType: 'fixed', offline: true })).toBe(false)
    expect(driveSpaceIsSafe({ driveType: 'unknown' })).toBe(false)
  })
})

describe('driveInfoForPath', () => {
  it('matches the volume letter', () => {
    expect(driveInfoForPath('C:\\Users\\x', [c, d])?.path).toBe('C:\\')
    expect(driveInfoForPath('\\\\nas\\share', [c])).toBeUndefined()
  })
})

describe('used / low', () => {
  it('computes used and low-space', () => {
    expect(usedBytesOf(c)).toBe(c.totalBytes! - c.freeBytes!)
    expect(driveSpaceIsLow(c)).toBe(false)
    expect(driveSpaceIsLow(d)).toBe(true)
  })
})
