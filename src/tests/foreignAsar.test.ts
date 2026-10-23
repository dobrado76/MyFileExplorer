import { describe, expect, it } from 'vitest'
import { isForeignAsarPath } from '../main/fs/foreignAsar'

const own = 'C:/Users/me/AppData/Local/Programs/MyFileExplorer/resources/app.asar'

describe('isForeignAsarPath', () => {
  it('treats another build’s app.asar as foreign', () => {
    expect(
      isForeignAsarPath('F:/Sites/MyFileExplorer/dist/win-unpacked/resources/app.asar', own)
    ).toBe(true)
    expect(
      isForeignAsarPath('F:/Sites/MyFileExplorer/release/win-unpacked/resources/app.asar', own)
    ).toBe(true)
    expect(
      isForeignAsarPath(
        'F:/Sites/Other/node_modules/electron/dist/resources/default_app.asar',
        own
      )
    ).toBe(true)
  })

  it('leaves this install’s own archive on the patched fs', () => {
    expect(isForeignAsarPath(own, own)).toBe(false)
    expect(isForeignAsarPath(own + '/out/main/index.js', own)).toBe(false)
  })

  it('ignores unpacked files and ordinary paths', () => {
    expect(
      isForeignAsarPath(
        'F:/Sites/MyFileExplorer/dist/win-unpacked/resources/app.asar.unpacked/node_modules/koffi/koffi.node',
        own
      )
    ).toBe(false)
    expect(isForeignAsarPath('F:/Sites/MyFileExplorer/README.md', own)).toBe(false)
  })
})