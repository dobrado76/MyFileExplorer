import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TAB_ICONS,
  coverCropRect,
  defaultTabIcon,
  isCustomTabIcon,
  isIconOnlyTab,
  isWindowsDriveRoot,
  tabCustomIconSizePx,
  tabIconPack
} from '../shared/tabIcons'

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

describe('coverCropRect', () => {
  it('takes the full frame when the source is already square', () => {
    expect(coverCropRect(128, 128)).toEqual({ left: 0, top: 0, width: 128, height: 128 })
  })

  it('crops the wide axis when the image is landscape', () => {
    expect(coverCropRect(200, 100)).toEqual({ left: 50, top: 0, width: 100, height: 100 })
  })

  it('crops the tall axis when the image is portrait', () => {
    expect(coverCropRect(80, 200)).toEqual({ left: 0, top: 60, width: 80, height: 80 })
  })
})

describe('custom tab icon helpers', () => {
  it('treats showLabel false as icon-only chrome', () => {
    const icon = { kind: 'custom' as const, id: 'ti_abc_1234', showLabel: false, sizePx: 32 }
    expect(isCustomTabIcon(icon)).toBe(true)
    expect(isIconOnlyTab(icon)).toBe(true)
    expect(tabCustomIconSizePx(icon)).toBe(32)
  })

  it('does not treat Lucide tabs as icon-only', () => {
    expect(isIconOnlyTab({ name: 'Folder', color: '#fbbf24' })).toBe(false)
    expect(isIconOnlyTab(null)).toBe(false)
  })

  it('treats missing pack as lucide', () => {
    expect(tabIconPack({ name: 'Folder', color: '#fbbf24' })).toBe('lucide')
    expect(tabIconPack({ name: 'Folder', color: '#fbbf24', pack: 'phosphor' })).toBe('phosphor')
  })
})
