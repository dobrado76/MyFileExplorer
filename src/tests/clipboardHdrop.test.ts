import { describe, expect, it } from 'vitest'
import { buildCfHdrop, parseCfHdrop } from '../main/shell/clipboardWin32'

describe('CF_HDROP encode/decode', () => {
  it('round-trips absolute paths for Explorer paste', () => {
    const paths = ['C:\\a.txt', 'D:\\folder\\b.png']
    expect(parseCfHdrop(buildCfHdrop(paths))).toEqual(paths)
  })

  it('encodes DROPFILES header + wide path list', () => {
    const buf = buildCfHdrop(['C:\\a.txt'])
    expect(buf.readUInt32LE(0)).toBe(20)
    expect(buf.readUInt32LE(16)).toBe(1)
  })
})
