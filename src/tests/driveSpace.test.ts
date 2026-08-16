import { describe, expect, it } from 'vitest'
import {
  driveInfoForPath,
  driveSpaceIsLow,
  formatAllDrivesSpace,
  formatDriveSpaceLine,
  formatFreeOfTotal,
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
  it('matches Explorer wording', () => {
    expect(formatFreeOfTotal(c.freeBytes!, c.totalBytes!)).toBe('120 GB free of 500 GB')
  })
})

describe('formatDriveSpaceLine', () => {
  it('prefixes the letter', () => {
    expect(formatDriveSpaceLine(c)).toBe('C: 120 GB free of 500 GB')
  })

  it('skips drives without sizes', () => {
    expect(formatDriveSpaceLine({ path: 'Z:\\', label: 'Z:', volumeName: '', offline: true })).toBeNull()
  })
})

describe('formatAllDrivesSpace', () => {
  it('joins online volumes', () => {
    expect(formatAllDrivesSpace([c, d, { path: 'Z:\\', label: 'Z:', volumeName: '' }])).toBe(
      'C: 120 GB free of 500 GB  ·  D: 8.0 GB free of 100 GB'
    )
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
