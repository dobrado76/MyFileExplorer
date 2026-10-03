import { describe, expect, it } from 'vitest'
import {
  applyUpdateSequence,
  assessRecoverability,
  bestFileName,
  filetimeToUnixMs,
  frnRecordIndex,
  parseDataRuns,
  parseFileRecord
} from '../main/fs/undelete/mftParse'
import {
  pathHintToRelativeSegments,
  resolveParentPath,
  sanitizeRecoverSegment
} from '../main/fs/undelete/scan'
import { decodeUndeleteToken, encodeUndeleteToken } from '../main/fs/undelete/token'

/** Build a minimal FILE record with resident $DATA and one $FILE_NAME. */
function buildResidentFileRecord(opts: {
  name: string
  parentFrn?: bigint
  inUse?: boolean
  isDirectory?: boolean
  data: Buffer
  sequence?: number
  /** Windows FILETIME for $FILE_NAME modification. */
  mtimeFt?: bigint
}): Buffer {
  const sector = 512
  const nameUtf16 = Buffer.from(opts.name, 'utf16le')
  const nameLenChars = opts.name.length
  const fnContent = Buffer.alloc(66 + nameUtf16.length)
  fnContent.writeBigUInt64LE(opts.parentFrn ?? 5n, 0)
  if (opts.mtimeFt != null) fnContent.writeBigUInt64LE(opts.mtimeFt, 0x10)
  fnContent.writeUInt8(nameLenChars, 64)
  fnContent.writeUInt8(1, 65) // Win32
  nameUtf16.copy(fnContent, 66)

  const fnAttrLen = Math.ceil((0x18 + fnContent.length) / 8) * 8
  const fnAttr = Buffer.alloc(fnAttrLen)
  fnAttr.writeUInt32LE(0x30, 0) // $FILE_NAME
  fnAttr.writeUInt32LE(fnAttrLen, 4)
  fnAttr.writeUInt8(0, 8) // resident
  fnAttr.writeUInt8(0, 9)
  fnAttr.writeUInt16LE(0, 10)
  fnAttr.writeUInt16LE(0, 12)
  fnAttr.writeUInt32LE(fnContent.length, 0x10)
  fnAttr.writeUInt16LE(0x18, 0x14)
  fnContent.copy(fnAttr, 0x18)

  const dataLen = opts.data.length
  const dataAttrLen = Math.ceil((0x18 + dataLen) / 8) * 8
  const dataAttr = Buffer.alloc(dataAttrLen)
  dataAttr.writeUInt32LE(0x80, 0) // $DATA
  dataAttr.writeUInt32LE(dataAttrLen, 4)
  dataAttr.writeUInt8(0, 8)
  dataAttr.writeUInt32LE(dataLen, 0x10)
  dataAttr.writeUInt16LE(0x18, 0x14)
  opts.data.copy(dataAttr, 0x18)

  const firstAttr = 0x38
  const attrs = Buffer.concat([fnAttr, dataAttr, Buffer.from([0xff, 0xff, 0xff, 0xff])])
  const realSize = firstAttr + attrs.length
  const buf = Buffer.alloc(sector)
  buf.write('FILE', 0)
  buf.writeUInt16LE(0x30, 4) // usa offset
  buf.writeUInt16LE(2, 6) // usa count (1 sector + usn)
  buf.writeUInt16LE(opts.sequence ?? 1, 0x10)
  buf.writeUInt16LE(firstAttr, 0x14)
  let flags = opts.inUse === false ? 0 : 1
  if (opts.isDirectory) flags |= 0x0002
  buf.writeUInt16LE(flags, 0x16)
  buf.writeUInt32LE(realSize, 0x18)
  attrs.copy(buf, firstAttr)
  // USA: place USN at usaOffset, then sector end marker
  const usn = 0x55aa
  buf.writeUInt16LE(usn, 0x30)
  buf.writeUInt16LE(0x1234, 0x32) // replacement for last 2 bytes of sector
  buf.writeUInt16LE(usn, sector - 2)
  return buf
}

describe('undelete mftParse', () => {
  it('parses data runlists (mapped + sparse)', () => {
    const runs = parseDataRuns(Buffer.from([0x21, 0x04, 0x64, 0x00, 0x01, 0x02, 0x00]))
    expect(runs).toEqual([
      { lcn: 100, length: 4 },
      { lcn: null, length: 2 }
    ])
  })

  it('applies update sequence fixup', () => {
    const buf = Buffer.alloc(512)
    buf.write('FILE', 0)
    buf.writeUInt16LE(0x30, 4)
    buf.writeUInt16LE(2, 6)
    buf.writeUInt16LE(0xabcd, 0x30)
    buf.writeUInt16LE(0x1111, 0x32)
    buf.writeUInt16LE(0xabcd, 510)
    expect(applyUpdateSequence(buf)).toBe(true)
    expect(buf.readUInt16LE(510)).toBe(0x1111)
  })

  it('parses resident FILE record with $FILE_NAME + $DATA', () => {
    const raw = buildResidentFileRecord({
      name: 'hello.txt',
      inUse: false,
      data: Buffer.from('payload'),
      sequence: 7
    })
    const rec = parseFileRecord(raw)
    expect(rec).not.toBeNull()
    expect(rec!.inUse).toBe(false)
    expect(rec!.sequence).toBe(7)
    const fn = bestFileName(rec!.fileNames)
    expect(fn?.name).toBe('hello.txt')
    expect(rec!.data?.resident).toBe(true)
    expect(rec!.data?.residentData?.toString()).toBe('payload')
    expect(assessRecoverability(rec!).status).toBe('good')
  })

  it('reads modification time from $FILE_NAME', () => {
    const unixMs = Date.UTC(2020, 0, 2)
    const ft = BigInt(unixMs + 11644473600000) * 10000n
    const raw = buildResidentFileRecord({
      name: 'dated.txt',
      inUse: false,
      data: Buffer.from('x'),
      mtimeFt: ft
    })
    const rec = parseFileRecord(raw)
    expect(rec!.mtimeMs).toBe(unixMs)
    expect(filetimeToUnixMs(ft)).toBe(unixMs)
  })

  it('marks directories unrecoverable in v1', () => {
    const raw = buildResidentFileRecord({
      name: 'folder',
      inUse: false,
      isDirectory: true,
      data: Buffer.alloc(0)
    })
    const rec = parseFileRecord(raw)
    expect(rec!.isDirectory).toBe(true)
    expect(assessRecoverability(rec!).status).toBe('unrecoverable')
  })

  it('uses 48-bit MFT record indexes in FRNs', () => {
    expect(frnRecordIndex(0x0001000000000042n)).toBe(0x42)
    expect(frnRecordIndex((5n << 48n) | 0x123456789abcn)).toBe(0x123456789abc)
  })

  it('round-trips undelete tokens', () => {
    const t = encodeUndeleteToken('C:', 42, 3)
    expect(decodeUndeleteToken(t)).toEqual({ letter: 'C', recordIndex: 42, sequence: 3 })
  })
})

describe('undelete path resolution', () => {
  it('builds parent folder paths from directory map (not the filename)', () => {
    const dirs = new Map([
      [10, { name: 'Photos', parentFrn: 5n, inUse: true }],
      [20, { name: '2024', parentFrn: 10n | (1n << 48n), inUse: true }]
    ])
    expect(resolveParentPath(20n, dirs, 'D')).toBe('D:\\Photos\\2024')
    expect(resolveParentPath(5n, dirs, 'D')).toBe('D:\\')
    expect(resolveParentPath(99n, dirs, 'D')).toBeNull()
    const partial = new Map([[30, { name: 'Orphan', parentFrn: 99n, inUse: false }]])
    expect(resolveParentPath(30n, partial, 'E')).toBe('E:\\…\\Orphan')
  })

  it('maps path hints to relative recover folder segments', () => {
    expect(pathHintToRelativeSegments('D:\\Photos\\2024', 'D')).toEqual(['Photos', '2024'])
    expect(pathHintToRelativeSegments('D:\\', 'D')).toEqual([])
    expect(pathHintToRelativeSegments(null, 'D')).toEqual([])
    expect(pathHintToRelativeSegments('E:\\…\\Orphan', 'E')).toEqual(['_incomplete', 'Orphan'])
    expect(sanitizeRecoverSegment('a:b*c?.txt')).toBe('a_b_c_.txt')
  })
})

describe('undelete non-resident $DATA', () => {
  it('parses non-resident attribute runlist from a synthetic record', () => {
    const sector = 1024
    const name = 'big.bin'
    const nameUtf16 = Buffer.from(name, 'utf16le')
    const fnContent = Buffer.alloc(66 + nameUtf16.length)
    fnContent.writeBigUInt64LE(5n, 0)
    fnContent.writeUInt8(name.length, 64)
    fnContent.writeUInt8(1, 65)
    nameUtf16.copy(fnContent, 66)
    const fnAttrLen = Math.ceil((0x18 + fnContent.length) / 8) * 8
    const fnAttr = Buffer.alloc(fnAttrLen)
    fnAttr.writeUInt32LE(0x30, 0)
    fnAttr.writeUInt32LE(fnAttrLen, 4)
    fnAttr.writeUInt32LE(fnContent.length, 0x10)
    fnAttr.writeUInt16LE(0x18, 0x14)
    fnContent.copy(fnAttr, 0x18)

    const runlist = Buffer.from([0x21, 0x08, 0x0a, 0x00, 0x00])
    const dataAttrLen = 0x40 + runlist.length + 8
    const dataAttr = Buffer.alloc(Math.ceil(dataAttrLen / 8) * 8)
    dataAttr.writeUInt32LE(0x80, 0)
    dataAttr.writeUInt32LE(dataAttr.length, 4)
    dataAttr.writeUInt8(1, 8)
    dataAttr.writeUInt16LE(0x40, 0x20)
    dataAttr.writeBigUInt64LE(8n * 4096n, 0x30)
    runlist.copy(dataAttr, 0x40)

    const firstAttr = 0x38
    const attrs = Buffer.concat([fnAttr, dataAttr, Buffer.from([0xff, 0xff, 0xff, 0xff])])
    const buf = Buffer.alloc(sector)
    buf.write('FILE', 0)
    buf.writeUInt16LE(0x30, 4)
    buf.writeUInt16LE(3, 6)
    buf.writeUInt16LE(1, 0x10)
    buf.writeUInt16LE(firstAttr, 0x14)
    buf.writeUInt16LE(0, 0x16)
    buf.writeUInt32LE(firstAttr + attrs.length, 0x18)
    attrs.copy(buf, firstAttr)
    const usn = 0x2222
    buf.writeUInt16LE(usn, 0x30)
    buf.writeUInt16LE(0xaaaa, 0x32)
    buf.writeUInt16LE(0xbbbb, 0x34)
    buf.writeUInt16LE(usn, 510)
    buf.writeUInt16LE(usn, 1022)

    const rec = parseFileRecord(buf, 512)
    expect(rec).not.toBeNull()
    expect(rec!.data?.resident).toBe(false)
    expect(rec!.data?.runs[0]).toEqual({ lcn: 10, length: 8 })
    expect(assessRecoverability(rec!).status).toBe('good')
  })
})
