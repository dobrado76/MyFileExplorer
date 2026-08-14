import { describe, expect, it } from 'vitest'
import { DEFAULT_TAB_ICONS, defaultTabIcon, isWindowsDriveRoot } from '../shared/tabIcons'

describe('isWindowsDriveRoot', () => {
  it('accepts drive letters with or without a trailing slash', () => {
    expect(isWindowsDriveRoot('C:\\')).toBe(true)
    expect(isWindowsDriveRoot('c:')).toBe(true)
    expect(isWindowsDriveRoot('D:/')).toBe(true)
  })

  it('rejects folders and UNC', () => {
    expect(isWindowsDriveRoot('C:\\Users')).toBe(false)
    expect(isWindowsDriveRoot('\\\\server\\share')).toBe(false)
  })
})

describe('defaultTabIcon', () => {
  it('uses Computer (blue Monitor) for an unscoped tab', () => {
    expect(defaultTabIcon('C:\\Users\\me')).toEqual(DEFAULT_TAB_ICONS.computer)
    expect(defaultTabIcon('C:\\', null)).toEqual(DEFAULT_TAB_ICONS.computer)
  })

  it('uses Drive (gray HardDrive) when a drive is the tree root', () => {
    expect(defaultTabIcon('D:\\Games', 'D:\\')).toEqual(DEFAULT_TAB_ICONS.drive)
    expect(defaultTabIcon('D:\\', 'D:\\')).toEqual(DEFAULT_TAB_ICONS.drive)
  })

  it('uses Folder (yellow) when a folder is the tree root', () => {
    expect(defaultTabIcon('C:\\Users\\me\\Pictures', 'C:\\Users\\me\\Pictures')).toEqual(
      DEFAULT_TAB_ICONS.folder
    )
  })
})
