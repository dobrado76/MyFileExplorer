import { describe, expect, it } from 'vitest'
import {
  isRecycleStorePath,
  parseRecycleMetaBuffer,
  recycleDataToMetaPath
} from '../main/fs/recycleIndex'

describe('recycleIndex', () => {
  it('detects physical recycle store paths', () => {
    expect(isRecycleStorePath('C:\\$Recycle.Bin\\S-1-5\\$RABC.txt')).toBe(true)
    expect(isRecycleStorePath('D:/$Recycle.Bin/S-1/$RFOO')).toBe(true)
    expect(isRecycleStorePath('C:\\Users\\me\\file.txt')).toBe(false)
  })

  it('maps $R data files to $I metadata siblings', () => {
    expect(recycleDataToMetaPath('C:\\$Recycle.Bin\\S-1\\$R12AB.txt')).toBe(
      'C:\\$Recycle.Bin\\S-1\\$I12AB.txt'
    )
  })

  it('parses recycle metadata v2', () => {
    const original = 'C:\\work\\report.docx'
    const pathUtf16 = Buffer.from(`${original}\0`, 'utf16le')
    const buf = Buffer.alloc(0x1c + pathUtf16.length)
    buf.writeBigUInt64LE(2n, 0)
    buf.writeBigUInt64LE(4096n, 8)
    buf.writeBigUInt64LE(120_000_000_000_000_000n, 0x10)
    buf.writeUInt32LE(pathUtf16.length / 2, 0x18)
    pathUtf16.copy(buf, 0x1c)

    const meta = parseRecycleMetaBuffer(buf)
    expect(meta?.originalPath).toBe(original)
    expect(meta?.size).toBe(4096)
    expect(meta?.deletedMs).toBeGreaterThan(0)
  })

  it('parses recycle metadata v1 fixed path', () => {
    const original = 'C:\\old\\note.txt'
    const pathUtf16 = Buffer.alloc(520)
    Buffer.from(`${original}\0`, 'utf16le').copy(pathUtf16)
    const buf = Buffer.alloc(0x218)
    buf.writeBigUInt64LE(1n, 0)
    buf.writeBigUInt64LE(12n, 8)
    buf.writeBigUInt64LE(13_000_000_000_000_000n, 0x10)
    pathUtf16.copy(buf, 0x18)

    expect(parseRecycleMetaBuffer(buf)?.originalPath).toBe(original)
  })
})
