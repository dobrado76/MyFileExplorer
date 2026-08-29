import { describe, expect, it } from 'vitest'
import { usnEnableRequestSchema, usnQueryRequestSchema } from '../shared/schemas/usn'
import {
  clampUsnJournalSizes,
  decodeUsnReasons,
  DEFAULT_USN_JOURNAL_DELTA_BYTES,
  DEFAULT_USN_JOURNAL_MAX_BYTES,
  driveLetterLabel,
  fileTimeToUnixMs,
  formatUsnReasons,
  isUsnJournalDeletingMessage,
  isUsnProbeFileName,
  mibToBytes,
  parseFsutilUsnQuery,
  parseFsutilUsnReadJournal,
  resolveUsnProbeDir,
  sameVolumePrefix,
  usnJournalFillRatio,
  usnProbeFileName
} from '../shared/usn/format'
import { parseUsnRecords } from '../main/search/ntfs/usnRecords'
import { parseUsnRecentCli } from '../main/fs/usnRecentCli'

function isWinDriveRootPath(path: string): boolean {
  return /^[a-zA-Z]:\\?$/.test(path.trim())
}

describe('USN formatters', () => {
  it('decodes common reason flags', () => {
    expect(decodeUsnReasons(0x00000100)).toEqual(['Create'])
    expect(formatUsnReasons(0x00000200 | 0x80000000)).toBe('Delete, Close')
    expect(formatUsnReasons(0)).toBe('—')
  })

  it('clamps journal sizes and keeps delta ≤ max', () => {
    expect(clampUsnJournalSizes(100, 50)).toEqual({
      maxBytes: 1024 * 1024,
      deltaBytes: 512 * 1024
    })
    const huge = clampUsnJournalSizes(mibToBytes(8), mibToBytes(64))
    expect(huge.deltaBytes).toBeLessThanOrEqual(huge.maxBytes)
    expect(clampUsnJournalSizes(DEFAULT_USN_JOURNAL_MAX_BYTES, DEFAULT_USN_JOURNAL_DELTA_BYTES)).toEqual({
      maxBytes: DEFAULT_USN_JOURNAL_MAX_BYTES,
      deltaBytes: DEFAULT_USN_JOURNAL_DELTA_BYTES
    })
  })

  it('estimates fill and converts FILETIME', () => {
    expect(usnJournalFillRatio('0', '32', '64')).toBe(0.5)
    expect(usnJournalFillRatio('10', '5', '64')).toBe(0)
    const unixMs = fileTimeToUnixMs(132000000000000000n)
    expect(unixMs).not.toBeNull()
    expect(unixMs!).toBeGreaterThan(0)
    expect(fileTimeToUnixMs(0n)).toBeNull()
  })

  it('formats drive letters', () => {
    expect(driveLetterLabel('c:\\')).toBe('C:')
    expect(driveLetterLabel('D:')).toBe('D:')
  })

  it('builds a unique probe filename on the same volume', () => {
    expect(usnProbeFileName('a1b2c3d4')).toBe('testing USN a1b2c3d4.txt')
    expect(isUsnProbeFileName('testing USN a1b2c3d4.txt')).toBe(true)
    expect(isUsnProbeFileName('notes.txt')).toBe(false)
    expect(resolveUsnProbeDir('Z:\\', 'C:\\Users\\me\\AppData\\Local\\Temp')).toBe('Z:\\')
    expect(resolveUsnProbeDir('C:\\', 'C:\\Users\\me\\AppData\\Local\\Temp')).toBe(
      'C:\\Users\\me\\AppData\\Local\\Temp'
    )
    expect(sameVolumePrefix('Z:\\', 'Z:\\testing USN a1b2c3d4.txt')).toBe(true)
    expect(sameVolumePrefix('Z:\\', 'C:\\testing USN a1b2c3d4.txt')).toBe(false)
  })

  it('parses fsutil usn queryjournal output', () => {
    const parsed = parseFsutilUsnQuery(`
Usn Journal ID          : 0x01d9abcdef000001
First Usn               : 0x0000000000000000
Next Usn                : 0x0000000000002000
Lowest Valid Usn        : 0x0000000000000000
Max Usn                 : 0x7FFFFFFFFFFFFFFF
Maximum Size            : 0x0000000004000000
Allocation Delta        : 0x0000000000800000
`)
    expect(parsed).not.toBeNull()
    expect(parsed!.maximumSize).toBe(0x4000000n)
    expect(parsed!.nextUsn).toBe(0x2000n)
    expect(parseFsutilUsnQuery('Error: The volume change journal is not active.')).toBeNull()
    expect(isUsnJournalDeletingMessage('Error 1178: The volume change journal is being deleted.')).toBe(
      true
    )
    expect(isUsnJournalDeletingMessage('The volume change journal is not active.')).toBe(false)
  })

  it('parses fsutil usn readjournal text records newest-first', () => {
    const parsed = parseFsutilUsnReadJournal(
      `
Usn                         : 100
File name                   : older.txt
File name length            : 18
Reason                      : 0x00000100: File create
Time stamp                  : 7/12/2018 11:04:30
File attributes             : 0x00000020: Archive

Usn                         : 200
File name                   : newer.txt
File name length            : 18
Reason                      : 0x80000200: File delete | Close
Time stamp                  : 7/12/2018 11:05:30
File attributes             : 0x00000010: Directory
`,
      200
    )
    expect(parsed).toHaveLength(2)
    expect(parsed[0]!.name).toBe('newer.txt')
    expect(parsed[0]!.isDir).toBe(true)
    expect(parsed[0]!.reason).toBe(0x80000200)
    expect(parsed[1]!.name).toBe('older.txt')
    expect(parsed[1]!.isDir).toBe(false)
  })

  it('parses USN_RECORD_V2 from a DeviceIoControl payload', () => {
    const name = 'hello.txt'
    const nameBytes = Buffer.from(name, 'utf16le')
    const recLen = 60 + nameBytes.length
    const rec = Buffer.alloc(recLen)
    rec.writeUInt32LE(recLen, 0)
    rec.writeUInt16LE(2, 4)
    rec.writeBigUInt64LE(0x11n, 8)
    rec.writeBigUInt64LE(0x22n, 16)
    rec.writeBigInt64LE(0x1000n, 24)
    rec.writeBigInt64LE(132000000000000000n, 32)
    rec.writeUInt32LE(0x100, 40)
    rec.writeUInt32LE(0, 52)
    rec.writeUInt16LE(nameBytes.length, 56)
    rec.writeUInt16LE(60, 58)
    nameBytes.copy(rec, 60)
    const parsed = parseUsnRecords(rec, 0, rec.length)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.name).toBe('hello.txt')
    expect(parsed[0]!.reason).toBe(0x100)
    expect(parsed[0]!.usn).toBe(0x1000n)
  })
})

describe('USN recent CLI argv', () => {
  it.skipIf(process.platform !== 'win32')('requires --usn-recent, a drive letter, and an absolute json path', () => {
    expect(parseUsnRecentCli(['electron.exe', '--usn-recent', 'C:', 'C:\\temp\\usn-recent-C.json'])).toEqual({
      letter: 'C:',
      outFile: 'C:\\temp\\usn-recent-C.json'
    })
    expect(parseUsnRecentCli(['electron.exe', '--usn-recent', 'C:\\', 'C:\\temp\\usn.json'])).toBeNull()
    expect(parseUsnRecentCli(['electron.exe', '--usn-recent', 'C:', 'usn.json'])).toBeNull()
    expect(parseUsnRecentCli(['electron.exe'])).toBeNull()
  })
})

describe('USN drive-root guard', () => {
  it('accepts only drive roots', () => {
    expect(isWinDriveRootPath('C:\\')).toBe(true)
    expect(isWinDriveRootPath('C:')).toBe(true)
    expect(isWinDriveRootPath('C:\\Users')).toBe(false)
    expect(isWinDriveRootPath('\\\\server\\share')).toBe(false)
    expect(isWinDriveRootPath('/home')).toBe(false)
  })
})

describe('USN schemas', () => {
  it('requires a path and rejects tiny enable sizes', () => {
    expect(usnQueryRequestSchema.safeParse({ path: 'C:\\' }).success).toBe(true)
    expect(usnEnableRequestSchema.safeParse({ path: 'C:\\', maxBytes: 100, deltaBytes: 50 }).success).toBe(
      false
    )
    expect(
      usnEnableRequestSchema.safeParse({
        path: 'C:\\',
        maxBytes: DEFAULT_USN_JOURNAL_MAX_BYTES,
        deltaBytes: DEFAULT_USN_JOURNAL_DELTA_BYTES
      }).success
    ).toBe(true)
  })
})
