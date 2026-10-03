/**
 * Full $MFT layout via $DATA runlists (handles fragmentation).
 * Linear reads from MftStartLcn only cover the first extent — wrong on large volumes.
 */
import {
  ATTR_DATA,
  ATTR_END,
  applyUpdateSequence,
  frnRecordIndex
} from './mftParse'
import { clusterOffset, readVolume, type NtfsVolumeData } from './volume'
import { logMain } from '../../logging'

export const ATTR_ATTRIBUTE_LIST = 0x20

export type MftRun = {
  startVcn: bigint
  clusters: bigint
  lcn: bigint | null
}

export type MftLayout = {
  vol: NtfsVolumeData
  runs: MftRun[]
  recordCount: number
}

/** Parse runlist with bigint LCNs (large volumes). */
export function parseDataRunsBig(
  runlist: Buffer
): Array<{ lcn: bigint | null; length: bigint }> {
  const runs: Array<{ lcn: bigint | null; length: bigint }> = []
  let off = 0
  let lcn = 0n
  while (off < runlist.length) {
    const header = runlist[off]!
    if (header === 0) break
    const lengthSize = header & 0x0f
    const offsetSize = (header >> 4) & 0x0f
    off++
    if (lengthSize === 0 || off + lengthSize + offsetSize > runlist.length) break
    let length = 0n
    for (let i = 0; i < lengthSize; i++) {
      length |= BigInt(runlist[off++]!) << BigInt(8 * i)
    }
    if (offsetSize === 0) {
      runs.push({ lcn: null, length })
      continue
    }
    let offset = 0n
    for (let i = 0; i < offsetSize; i++) {
      offset |= BigInt(runlist[off++]!) << BigInt(8 * i)
    }
    const bits = BigInt(offsetSize * 8)
    const signBit = 1n << (bits - 1n)
    if ((offset & signBit) !== 0n) {
      offset -= 1n << bits
    }
    lcn += offset
    runs.push({ lcn, length })
  }
  return runs
}

type AttrListEntry = {
  type: number
  startVcn: bigint
  segmentIndex: number
  name: string
}

function parseAttrListEntries(content: Buffer): AttrListEntry[] {
  const out: AttrListEntry[] = []
  let off = 0
  while (off + 0x1a <= content.length) {
    const type = content.readUInt32LE(off)
    if (type === ATTR_END || type === 0xffffffff) break
    const recLen = content.readUInt16LE(off + 4)
    if (recLen < 0x1a || off + recLen > content.length) break
    const nameLen = content.readUInt8(off + 6)
    const nameOff = content.readUInt8(off + 7)
    const startVcn = content.readBigUInt64LE(off + 8)
    const segmentRef = content.readBigUInt64LE(off + 0x10)
    let name = ''
    if (nameLen > 0 && nameOff + nameLen * 2 <= recLen) {
      name = content.toString('utf16le', off + nameOff, off + nameOff + nameLen * 2)
    }
    out.push({
      type,
      startVcn,
      segmentIndex: frnRecordIndex(segmentRef),
      name
    })
    off += recLen
  }
  return out
}

type RawDataPiece = { lowestVcn: bigint; runs: Array<{ lcn: bigint | null; length: bigint }> }

function collectUnnamedDataPieces(raw: Buffer, bytesPerSector: number): {
  pieces: RawDataPiece[]
  attrList: Buffer | null
} {
  if (raw.length < 0x30 || raw.toString('ascii', 0, 4) !== 'FILE') {
    return { pieces: [], attrList: null }
  }
  const buf = Buffer.from(raw)
  applyUpdateSequence(buf, bytesPerSector)
  const firstAttr = buf.readUInt16LE(0x14)
  const realSize = buf.readUInt32LE(0x18)
  const pieces: RawDataPiece[] = []
  let attrList: Buffer | null = null
  let off = firstAttr
  while (off + 8 <= buf.length && off + 8 <= realSize) {
    const type = buf.readUInt32LE(off)
    if (type === ATTR_END) break
    const len = buf.readUInt32LE(off + 4)
    if (len < 0x18 || off + len > buf.length) break
    const nonResident = buf.readUInt8(off + 8) !== 0
    const nameLength = buf.readUInt8(off + 9)
    const nameOffset = buf.readUInt16LE(off + 10)
    let attrName = ''
    if (nameLength > 0 && nameOffset + nameLength * 2 <= len) {
      attrName = buf.toString('utf16le', off + nameOffset, off + nameOffset + nameLength * 2)
    }
    const attrBuf = buf.subarray(off, off + len)
    if (type === ATTR_ATTRIBUTE_LIST) {
      if (!nonResident) {
        const valueLen = attrBuf.readUInt32LE(0x10)
        const valueOff = attrBuf.readUInt16LE(0x14)
        if (valueOff + valueLen <= attrBuf.length) {
          attrList = Buffer.from(attrBuf.subarray(valueOff, valueOff + valueLen))
        }
      }
      // Non-resident ATTR_LIST on $MFT is rare at bootstrap; skip for now.
    } else if (type === ATTR_DATA && attrName === '' && nonResident && attrBuf.length >= 0x40) {
      const lowestVcn = attrBuf.readBigUInt64LE(0x10)
      const runOff = attrBuf.readUInt16LE(0x20)
      if (runOff < attrBuf.length) {
        pieces.push({
          lowestVcn,
          runs: parseDataRunsBig(attrBuf.subarray(runOff))
        })
      }
    }
    off += len
  }
  return { pieces, attrList }
}

function piecesToMftRuns(pieces: RawDataPiece[]): MftRun[] {
  const sorted = [...pieces].sort((a, b) => (a.lowestVcn < b.lowestVcn ? -1 : 1))
  const runs: MftRun[] = []
  for (const piece of sorted) {
    let vcn = piece.lowestVcn
    for (const r of piece.runs) {
      runs.push({ startVcn: vcn, clusters: r.length, lcn: r.lcn })
      vcn += r.length
    }
  }
  return runs
}

/** Byte offset on the volume for an MFT record index, or null if unmapped/sparse. */
export function mftRecordVolumeOffset(layout: MftLayout, recordIndex: number): bigint | null {
  if (recordIndex < 0 || recordIndex >= layout.recordCount) return null
  const byteOff = BigInt(recordIndex) * BigInt(layout.vol.bytesPerFileRecord)
  const bpc = BigInt(layout.vol.bytesPerCluster)
  const vcn = byteOff / bpc
  const within = byteOff % bpc
  for (const run of layout.runs) {
    const end = run.startVcn + run.clusters
    if (vcn >= run.startVcn && vcn < end) {
      if (run.lcn == null) return null
      const clusterInto = vcn - run.startVcn
      return run.lcn * bpc + clusterInto * bpc + within
    }
  }
  return null
}

/**
 * Read `count` FILE records starting at `startRecord` following $MFT runs.
 * May return fewer bytes if a sparse hole or EOF is hit.
 */
export function readMftRecords(
  handle: unknown,
  layout: MftLayout,
  startRecord: number,
  count: number
): Buffer | null {
  if (count <= 0 || startRecord < 0 || startRecord >= layout.recordCount) return null
  const recordSize = layout.vol.bytesPerFileRecord
  const want = Math.min(count, layout.recordCount - startRecord)
  const out = Buffer.alloc(want * recordSize)
  let written = 0
  let rec = startRecord
  while (written < out.length && rec < layout.recordCount) {
    const volOff = mftRecordVolumeOffset(layout, rec)
    if (volOff == null) {
      // Sparse / unmapped — leave zeros (not a FILE record)
      written += recordSize
      rec++
      continue
    }
    // Read as many contiguous records as this run allows.
    let runContiguous = 1
    while (rec + runContiguous < layout.recordCount && written + runContiguous * recordSize <= out.length) {
      const nextOff = mftRecordVolumeOffset(layout, rec + runContiguous)
      if (nextOff == null || nextOff !== volOff + BigInt(runContiguous * recordSize)) break
      runContiguous++
    }
    const maxRecs = Math.floor((out.length - written) / recordSize)
    const n = Math.min(runContiguous, maxRecs)
    const chunk = readVolume(handle, volOff, n * recordSize)
    if (!chunk || chunk.length < recordSize) break
    const got = Math.floor(chunk.length / recordSize) * recordSize
    chunk.copy(out, written, 0, got)
    written += got
    rec += got / recordSize
    if (got < n * recordSize) break
  }
  return written >= recordSize ? out.subarray(0, written) : null
}

function recordCountFromLayout(vol: NtfsVolumeData, runs: MftRun[]): number {
  const fromValid = vol.mftValidDataLength / BigInt(vol.bytesPerFileRecord)
  let coveredClusters = 0n
  for (const r of runs) coveredClusters += r.clusters
  const fromRuns =
    (coveredClusters * BigInt(vol.bytesPerCluster)) / BigInt(vol.bytesPerFileRecord)
  // Prefer the larger — ValidDataLength can exceed mapped runs if ATTR_LIST was incomplete;
  // runs can exceed ValidDataLength slightly due to allocation granularity.
  const n = fromValid > fromRuns ? fromValid : fromRuns
  const asNum = Number(n)
  if (!Number.isFinite(asNum) || asNum < 1) return 1
  return Math.min(Math.floor(asNum), Number.MAX_SAFE_INTEGER)
}

function contiguousFallback(vol: NtfsVolumeData): MftLayout {
  const recordCount = Math.max(
    1,
    Number(vol.mftValidDataLength / BigInt(vol.bytesPerFileRecord))
  )
  const clusters =
    (BigInt(recordCount) * BigInt(vol.bytesPerFileRecord) + BigInt(vol.bytesPerCluster) - 1n) /
    BigInt(vol.bytesPerCluster)
  return {
    vol,
    runs: [{ startVcn: 0n, clusters, lcn: vol.mftStartLcn }],
    recordCount
  }
}

/**
 * Build a full $MFT byte map by reading record 0 (+ ATTR_LIST segments).
 */
export function buildMftLayout(handle: unknown, vol: NtfsVolumeData): MftLayout {
  const recSize = vol.bytesPerFileRecord
  const rec0 = readVolume(handle, clusterOffset(vol, vol.mftStartLcn), recSize)
  if (!rec0 || rec0.length < recSize) {
    logMain('warn', 'Undelete: could not read $MFT record 0; falling back to contiguous map')
    return contiguousFallback(vol)
  }

  const { pieces, attrList } = collectUnnamedDataPieces(rec0, vol.bytesPerSector)
  const allPieces = [...pieces]

  // Bootstrap map from whatever runs record 0 already has (usually the first extent).
  let bootstrap = piecesToMftRuns(allPieces)
  if (bootstrap.length === 0) {
    bootstrap = [{ startVcn: 0n, clusters: 16n, lcn: vol.mftStartLcn }]
  }
  let layout: MftLayout = {
    vol,
    runs: bootstrap,
    recordCount: recordCountFromLayout(vol, bootstrap)
  }

  if (attrList) {
    const entries = parseAttrListEntries(attrList).filter(
      (e) => e.type === ATTR_DATA && e.name === ''
    )
    for (const ent of entries) {
      // Segment often already covered by base $DATA; still merge runs from that record.
      const segBuf = readMftRecords(handle, layout, ent.segmentIndex, 1)
      if (!segBuf) {
        // Early segment still in the first physical extent?
        const linear = readVolume(
          handle,
          clusterOffset(vol, vol.mftStartLcn) + BigInt(ent.segmentIndex) * BigInt(recSize),
          recSize
        )
        if (!linear) continue
        const part = collectUnnamedDataPieces(linear, vol.bytesPerSector)
        allPieces.push(...part.pieces)
        continue
      }
      const part = collectUnnamedDataPieces(segBuf, vol.bytesPerSector)
      allPieces.push(...part.pieces)
    }
    const merged = piecesToMftRuns(allPieces)
    if (merged.length > 0) {
      layout = {
        vol,
        runs: merged,
        recordCount: recordCountFromLayout(vol, merged)
      }
    }
  }

  if (layout.runs.length === 0) {
    logMain('warn', 'Undelete: $MFT had no data runs; contiguous fallback')
    return contiguousFallback(vol)
  }

  logMain(
    'info',
    `Undelete: $MFT map ${layout.runs.length} run(s), ~${layout.recordCount.toLocaleString()} records`
  )
  return layout
}
