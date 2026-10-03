/**
 * Pure NTFS MFT FILE-record parsers (classic undelete).
 * No volume IO — feed buffers from tests or the volume reader.
 */

export const ATTR_STANDARD_INFORMATION = 0x10
export const ATTR_FILE_NAME = 0x30
export const ATTR_DATA = 0x80
export const ATTR_INDEX_ROOT = 0x90
export const ATTR_END = 0xffffffff

export const FILE_RECORD_IN_USE = 0x0001
export const FILE_RECORD_IS_DIRECTORY = 0x0002

export const ATTR_FLAG_COMPRESSED = 0x0001
export const ATTR_FLAG_ENCRYPTED = 0x4000
export const ATTR_FLAG_SPARSE = 0x8000

export type DataRun = { lcn: number | null; length: number }

export type ParsedFileName = {
  parentFrn: bigint
  name: string
  namespace: number
  /** Modification time from this $FILE_NAME attribute (ms since epoch), if present. */
  mtimeMs: number | null
}

export type ParsedDataStream = {
  name: string
  resident: boolean
  size: number
  /** Resident payload, if any. */
  residentData: Buffer | null
  runs: DataRun[]
  compressed: boolean
  encrypted: boolean
  sparse: boolean
}

export type ParsedFileRecord = {
  frnLow: number
  sequence: number
  inUse: boolean
  isDirectory: boolean
  fileNames: ParsedFileName[]
  /** Unnamed $DATA (default stream), if present in this base record. */
  data: ParsedDataStream | null
  /** Best-effort last-write time (prefers $STANDARD_INFORMATION). */
  mtimeMs: number | null
  /** Real size of the FILE record used. */
  recordBytes: number
}

/** Windows FILETIME (100ns since 1601-01-01) → Unix ms, or null if unset/invalid. */
export function filetimeToUnixMs(ft: bigint): number | null {
  if (ft <= 0n) return null
  const ms = Number(ft / 10000n - 11644473600000n)
  if (!Number.isFinite(ms) || ms < 0 || ms > 4e13) return null
  return ms
}

/** Apply NTFS update sequence (USA) fixup to a FILE/INDX sector buffer in place. */
export function applyUpdateSequence(buf: Buffer, bytesPerSector = 512): boolean {
  if (buf.length < 8) return false
  const usaOffset = buf.readUInt16LE(4)
  const usaCount = buf.readUInt16LE(6)
  if (usaOffset < 0x2a || usaCount < 2) return false
  if (usaOffset + usaCount * 2 > buf.length) return false
  const usa = buf.subarray(usaOffset, usaOffset + usaCount * 2)
  const sectors = usaCount - 1
  for (let i = 0; i < sectors; i++) {
    const sectorEnd = (i + 1) * bytesPerSector - 2
    if (sectorEnd + 2 > buf.length) return false
    const expected = usa.readUInt16LE(0)
    const actual = buf.readUInt16LE(sectorEnd)
    if (actual !== expected) {
      // Some partial records fail USA — still try without aborting the whole scan.
    }
    buf.writeUInt16LE(usa.readUInt16LE((i + 1) * 2), sectorEnd)
  }
  return true
}

export function parseDataRuns(runlist: Buffer): DataRun[] {
  const runs: DataRun[] = []
  let off = 0
  let lcn = 0
  while (off < runlist.length) {
    const header = runlist[off]!
    if (header === 0) break
    const lengthSize = header & 0x0f
    const offsetSize = (header >> 4) & 0x0f
    off++
    if (lengthSize === 0 || off + lengthSize + offsetSize > runlist.length) break
    let length = 0
    for (let i = 0; i < lengthSize; i++) {
      length |= runlist[off++]! << (8 * i)
    }
    let offset = 0
    if (offsetSize > 0) {
      for (let i = 0; i < offsetSize; i++) {
        offset |= runlist[off++]! << (8 * i)
      }
      // Sign-extend
      const signBit = 1 << (offsetSize * 8 - 1)
      if (offset & signBit) {
        offset -= 1 << (offsetSize * 8)
      }
      lcn += offset
      runs.push({ lcn, length })
    } else {
      // Sparse run
      runs.push({ lcn: null, length })
    }
  }
  return runs
}

function parseFileNameAttr(content: Buffer): ParsedFileName | null {
  if (content.length < 66) return null
  const parentFrn = content.readBigUInt64LE(0)
  const mtimeMs = content.length >= 24 ? filetimeToUnixMs(content.readBigUInt64LE(0x10)) : null
  const nameLen = content.readUInt8(64)
  const namespace = content.readUInt8(65)
  const nameBytes = nameLen * 2
  if (66 + nameBytes > content.length) return null
  const name = content.toString('utf16le', 66, 66 + nameBytes)
  if (!name) return null
  return { parentFrn, name, namespace, mtimeMs }
}

function parseDataAttr(
  attr: Buffer,
  nonResident: boolean,
  name: string,
  flags: number
): ParsedDataStream | null {
  const compressed = (flags & ATTR_FLAG_COMPRESSED) !== 0
  const encrypted = (flags & ATTR_FLAG_ENCRYPTED) !== 0
  const sparse = (flags & ATTR_FLAG_SPARSE) !== 0
  if (!nonResident) {
    if (attr.length < 0x18) return null
    const valueLen = attr.readUInt32LE(0x10)
    const valueOff = attr.readUInt16LE(0x14)
    if (valueOff + valueLen > attr.length) return null
    const residentData = Buffer.from(attr.subarray(valueOff, valueOff + valueLen))
    return {
      name,
      resident: true,
      size: valueLen,
      residentData,
      runs: [],
      compressed,
      encrypted,
      sparse
    }
  }
  if (attr.length < 0x40) return null
  const dataSize = Number(attr.readBigUInt64LE(0x30))
  const runOff = attr.readUInt16LE(0x20)
  if (runOff >= attr.length) return null
  const runs = parseDataRuns(attr.subarray(runOff))
  return {
    name,
    resident: false,
    size: dataSize,
    residentData: null,
    runs,
    compressed,
    encrypted,
    sparse
  }
}

/**
 * Parse one fixed-size FILE record buffer (already USA-fixed preferred).
 * Returns null if signature is wrong.
 */
export function parseFileRecord(raw: Buffer, bytesPerSector = 512): ParsedFileRecord | null {
  if (raw.length < 0x30) return null
  if (raw.toString('ascii', 0, 4) !== 'FILE') return null
  const buf = Buffer.from(raw)
  applyUpdateSequence(buf, bytesPerSector)

  const sequence = buf.readUInt16LE(0x10)
  const firstAttr = buf.readUInt16LE(0x14)
  const flags = buf.readUInt16LE(0x16)
  const realSize = buf.readUInt32LE(0x18)
  const frnLow = buf.length >= 0x2c + 4 ? buf.readUInt32LE(0x2c) : 0
  // Record number is often at offset 0x2C in newer records (NTFS 3.x) as 4-byte MFT index;
  // when missing, caller supplies FRN from position.

  const fileNames: ParsedFileName[] = []
  let data: ParsedDataStream | null = null
  let mtimeMs: number | null = null
  let hasIndexRoot = false

  let off = firstAttr
  while (off + 8 <= buf.length && off + 8 <= realSize) {
    const type = buf.readUInt32LE(off)
    if (type === ATTR_END) break
    const len = buf.readUInt32LE(off + 4)
    if (len < 0x18 || off + len > buf.length) break
    const nonResident = buf.readUInt8(off + 8) !== 0
    const nameLength = buf.readUInt8(off + 9)
    const nameOffset = buf.readUInt16LE(off + 10)
    const attrFlags = buf.readUInt16LE(off + 12)
    let attrName = ''
    if (nameLength > 0 && nameOffset + nameLength * 2 <= len) {
      attrName = buf.toString('utf16le', off + nameOffset, off + nameOffset + nameLength * 2)
    }
    const attrBuf = buf.subarray(off, off + len)
    if (type === ATTR_STANDARD_INFORMATION && !nonResident) {
      const valueLen = attrBuf.readUInt32LE(0x10)
      const valueOff = attrBuf.readUInt16LE(0x14)
      if (valueOff + 16 <= attrBuf.length && valueLen >= 16) {
        mtimeMs = filetimeToUnixMs(attrBuf.readBigUInt64LE(valueOff + 8))
      }
    } else if (type === ATTR_FILE_NAME && !nonResident) {
      const valueLen = attrBuf.readUInt32LE(0x10)
      const valueOff = attrBuf.readUInt16LE(0x14)
      if (valueOff + valueLen <= attrBuf.length) {
        const fn = parseFileNameAttr(attrBuf.subarray(valueOff, valueOff + valueLen))
        if (fn) fileNames.push(fn)
      }
    } else if (type === ATTR_DATA && attrName === '') {
      const stream = parseDataAttr(attrBuf, nonResident, attrName, attrFlags)
      if (stream) data = stream
    } else if (type === ATTR_INDEX_ROOT) {
      hasIndexRoot = true
    }
    off += len
  }

  if (mtimeMs == null && fileNames.length > 0) {
    const win32 = fileNames.find((n) => n.namespace === 1 || n.namespace === 3)
    mtimeMs = (win32 ?? fileNames[0])?.mtimeMs ?? null
  }

  return {
    frnLow,
    sequence,
    inUse: (flags & FILE_RECORD_IN_USE) !== 0,
    isDirectory: (flags & FILE_RECORD_IS_DIRECTORY) !== 0 || hasIndexRoot,
    fileNames,
    data,
    mtimeMs,
    recordBytes: realSize
  }
}

export type Recoverability = 'good' | 'poor' | 'unrecoverable'

export function assessRecoverability(
  rec: ParsedFileRecord
): { status: Recoverability; size: number } {
  if (rec.isDirectory) {
    return { status: 'unrecoverable', size: 0 }
  }
  const d = rec.data
  if (!d) return { status: 'unrecoverable', size: 0 }
  if (d.encrypted || d.compressed) return { status: 'unrecoverable', size: d.size }
  if (d.resident) {
    return { status: d.residentData && d.residentData.length > 0 ? 'good' : 'poor', size: d.size }
  }
  if (d.runs.length === 0) return { status: 'unrecoverable', size: d.size }
  const hasSparse = d.runs.some((r) => r.lcn == null)
  const hasMapped = d.runs.some((r) => r.lcn != null)
  if (!hasMapped && d.size > 0) return { status: 'unrecoverable', size: d.size }
  if (hasSparse) return { status: 'poor', size: d.size }
  return { status: 'good', size: d.size }
}

/** Prefer Win32 namespace name over DOS 8.3. */
export function bestFileName(names: ParsedFileName[]): ParsedFileName | null {
  if (names.length === 0) return null
  const win32 = names.find((n) => n.namespace === 1 || n.namespace === 3)
  return win32 ?? names[0]!
}

export function makeFrn(recordIndex: number, sequence: number): bigint {
  return (BigInt(recordIndex) & 0xffffffffffffn) | (BigInt(sequence & 0xffff) << 48n)
}

/** Lower 48 bits of an NTFS file reference = MFT record index. */
export function frnRecordIndex(frn: bigint): number {
  return Number(frn & 0xffffffffffffn)
}
