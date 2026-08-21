import { Buffer } from 'node:buffer'
import { fileTimeToUnixMs } from '@shared/usn/format'

const FILE_ATTRIBUTE_DIRECTORY = 0x10

export type ParsedUsnRecord = {
  frn: bigint
  parentFrn: bigint
  name: string
  isDir: boolean
  reason: number
  usn: bigint
  timeMs: number | null
}

/** Parse USN_RECORD_V2 / V3 from an FSCTL_READ / ENUM output buffer (records start at `start`). */
export function parseUsnRecords(buf: Buffer, start: number, end: number): ParsedUsnRecord[] {
  const out: ParsedUsnRecord[] = []
  let offset = start
  while (offset + 60 <= end) {
    const recordLength = buf.readUInt32LE(offset)
    if (recordLength < 60 || offset + recordLength > end) break
    const major = buf.readUInt16LE(offset + 4)
    const parsed =
      major === 2
        ? parseV2(buf, offset, recordLength)
        : major === 3
          ? parseV3(buf, offset, recordLength)
          : null
    if (parsed) out.push(parsed)
    offset += recordLength
  }
  return out
}

function readName(buf: Buffer, offset: number, recordLength: number, nameLen: number, nameOff: number): string {
  if (nameLen <= 0 || nameOff < 0 || offset + nameOff + nameLen > offset + recordLength) return ''
  return buf.toString('utf16le', offset + nameOff, offset + nameOff + nameLen)
}

function parseV2(buf: Buffer, offset: number, recordLength: number): ParsedUsnRecord | null {
  const nameLen = buf.readUInt16LE(offset + 56)
  const nameOff = buf.readUInt16LE(offset + 58)
  return {
    frn: buf.readBigUInt64LE(offset + 8),
    parentFrn: buf.readBigUInt64LE(offset + 16),
    usn: buf.readBigInt64LE(offset + 24),
    timeMs: fileTimeToUnixMs(buf.readBigInt64LE(offset + 32)),
    reason: buf.readUInt32LE(offset + 40),
    isDir: (buf.readUInt32LE(offset + 52) & FILE_ATTRIBUTE_DIRECTORY) !== 0,
    name: readName(buf, offset, recordLength, nameLen, nameOff)
  }
}

/** V3 uses 16-byte FILE_ID_128; the first 8 bytes are the NTFS FRN. */
function parseV3(buf: Buffer, offset: number, recordLength: number): ParsedUsnRecord | null {
  if (recordLength < 76) return null
  const nameLen = buf.readUInt16LE(offset + 72)
  const nameOff = buf.readUInt16LE(offset + 74)
  return {
    frn: buf.readBigUInt64LE(offset + 8),
    parentFrn: buf.readBigUInt64LE(offset + 24),
    usn: buf.readBigInt64LE(offset + 40),
    timeMs: fileTimeToUnixMs(buf.readBigInt64LE(offset + 48)),
    reason: buf.readUInt32LE(offset + 56),
    isDir: (buf.readUInt32LE(offset + 68) & FILE_ATTRIBUTE_DIRECTORY) !== 0,
    name: readName(buf, offset, recordLength, nameLen, nameOff)
  }
}
