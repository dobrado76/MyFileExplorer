/**
 * List UDF (ECMA-167) directory trees via random-access reads.
 * Windows / many modern ISOs put real content here; ISO9660 is often a stub README.
 *
 * long_ad.partition is a **partition map reference** (index), not the PartitionNumber
 * from the Partition Descriptor — Windows ISOs often use PartitionNumber ≠ 0.
 */
import type { FileHandle } from 'node:fs/promises'
import { MAX_ZIP_TREE_NODES, type ZipListEntry } from './zipArchive'

const SECTOR = 2048
const AVDP_SECTORS = [256, 512] as const
const TAG_ANCHOR = 2
const TAG_PARTITION = 5
const TAG_LOGICAL_VOLUME = 6
const TAG_TERMINATOR = 8
const TAG_FILE_SET = 256
const TAG_FILE_ID = 257
const TAG_FILE_ENTRY = 261
const TAG_EXTENDED_FILE_ENTRY = 266

const ICB_SHORT = 0
const ICB_LONG = 1
const ICB_EXTENDED = 2
const ICB_INLINE = 3

const MAX_DIR_BYTES = 16 * 1024 * 1024
const MAX_DEPTH = 64

function verifyTag(data: Buffer, offset = 0): number | null {
  if (offset + 16 > data.length) return null
  const tagId = data.readUInt16LE(offset)
  let sum = 0
  for (let i = 0; i < 16; i++) {
    if (i !== 4) sum = (sum + data[offset + i]!) & 0xff
  }
  if (sum !== data[offset + 4]) return null
  return tagId
}

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  const { bytesRead } = await fh.read(buf, 0, length, position)
  if (bytesRead < length) throw new Error('Unexpected end of disc image')
  return buf
}

async function readSector(fh: FileHandle, sector: number): Promise<Buffer> {
  return readAt(fh, sector * SECTOR, SECTOR)
}

function decodeUdfName(raw: Buffer): string {
  if (raw.length === 0) return ''
  const kind = raw[0]!
  const body = raw.subarray(1)
  if (kind === 8) return body.toString('utf8').replace(/\0/g, '')
  if (kind === 16) return new TextDecoder('utf-16be').decode(body).replace(/\0/g, '')
  return raw.toString('latin1').replace(/\0/g, '')
}

type LongAd = { length: number; location: number; partitionRef: number }

/** PartitionNumber → start sector on volume. */
type PartStarts = Map<number, number>
/** Partition map reference index → PartitionNumber. */
type PartRefs = number[]

function parseLongAd(buf: Buffer, offset: number): LongAd {
  return {
    length: buf.readUInt32LE(offset) & 0x3fffffff,
    location: buf.readUInt32LE(offset + 4),
    partitionRef: buf.readUInt16LE(offset + 8)
  }
}

function parseShortAd(buf: Buffer, offset: number): { length: number; position: number } {
  return {
    length: buf.readUInt32LE(offset) & 0x3fffffff,
    position: buf.readUInt32LE(offset + 4)
  }
}

function partNumberForRef(refs: PartRefs, partitionRef: number): number {
  if (partitionRef >= 0 && partitionRef < refs.length) return refs[partitionRef]!
  return partitionRef
}

function partitionByteOffset(
  starts: PartStarts,
  refs: PartRefs,
  partitionRef: number,
  block: number
): number {
  const partNum = partNumberForRef(refs, partitionRef)
  const start = starts.get(partNum)
  const base = start !== undefined ? start : 0
  return (base + block) * SECTOR
}

type FileEntryMeta = {
  infoLength: number
  descType: number
  adBytes: Buffer
  partitionRefHint: number
}

async function readFileEntryMeta(
  fh: FileHandle,
  starts: PartStarts,
  refs: PartRefs,
  icbLoc: number,
  icbPartRef: number
): Promise<FileEntryMeta | null> {
  const offset = partitionByteOffset(starts, refs, icbPartRef, icbLoc)
  const entry = await readAt(fh, offset, SECTOR)
  const tagId = verifyTag(entry)
  const isExt = tagId === TAG_EXTENDED_FILE_ENTRY
  if (tagId !== TAG_FILE_ENTRY && !isExt) return null

  const descType = entry.readUInt16LE(34) & 0x07
  const infoLength = Number(entry.readBigUInt64LE(56))
  let eaLength: number
  let adLength: number
  let adOffset: number
  if (isExt) {
    eaLength = entry.readUInt32LE(204)
    adLength = entry.readUInt32LE(208)
    adOffset = 212 + eaLength
  } else {
    eaLength = entry.readUInt32LE(168)
    adLength = entry.readUInt32LE(172)
    adOffset = 176 + eaLength
  }
  if (adOffset > entry.length) return null
  if (adOffset + adLength > entry.length) adLength = Math.max(0, entry.length - adOffset)
  return {
    infoLength,
    descType,
    adBytes: entry.subarray(adOffset, adOffset + adLength),
    partitionRefHint: icbPartRef
  }
}

async function readAllocatedBytes(
  fh: FileHandle,
  starts: PartStarts,
  refs: PartRefs,
  meta: FileEntryMeta,
  maxBytes: number
): Promise<Buffer> {
  const want = Math.min(meta.infoLength, maxBytes)
  if (want <= 0) return Buffer.alloc(0)

  if (meta.descType === ICB_INLINE) {
    return meta.adBytes.subarray(0, Math.min(meta.adBytes.length, want))
  }

  const chunks: Buffer[] = []
  let got = 0
  const ads = meta.adBytes
  let pos = 0

  const pushExtent = async (byteOff: number, length: number): Promise<void> => {
    if (length <= 0 || got >= want) return
    const take = Math.min(length, want - got)
    chunks.push(await readAt(fh, byteOff, take))
    got += take
  }

  if (meta.descType === ICB_SHORT) {
    while (pos + 8 <= ads.length && got < want) {
      const ad = parseShortAd(ads, pos)
      pos += 8
      if (ad.length === 0) break
      await pushExtent(
        partitionByteOffset(starts, refs, meta.partitionRefHint, ad.position),
        ad.length
      )
    }
  } else if (meta.descType === ICB_LONG) {
    while (pos + 16 <= ads.length && got < want) {
      const ad = parseLongAd(ads, pos)
      pos += 16
      if (ad.length === 0) break
      await pushExtent(partitionByteOffset(starts, refs, ad.partitionRef, ad.location), ad.length)
    }
  } else if (meta.descType === ICB_EXTENDED) {
    while (pos + 20 <= ads.length && got < want) {
      const length = ads.readUInt32LE(pos) & 0x3fffffff
      const block = ads.readUInt32LE(pos + 12)
      const partRef = ads.readUInt16LE(pos + 16)
      pos += 20
      if (length === 0) break
      await pushExtent(partitionByteOffset(starts, refs, partRef, block), length)
    }
  }

  return Buffer.concat(chunks, got)
}

async function walkDirectory(
  fh: FileHandle,
  starts: PartStarts,
  refs: PartRefs,
  icbLoc: number,
  icbPartRef: number,
  prefix: string,
  entries: ZipListEntry[],
  visited: Set<string>,
  depth: number,
  state: { truncated: boolean }
): Promise<void> {
  if (state.truncated || depth > MAX_DEPTH || entries.length >= MAX_ZIP_TREE_NODES + 64) {
    state.truncated = true
    return
  }
  const key = `${icbPartRef}:${icbLoc}`
  if (visited.has(key)) return
  visited.add(key)

  const meta = await readFileEntryMeta(fh, starts, refs, icbLoc, icbPartRef)
  if (!meta) return
  const dirData = await readAllocatedBytes(fh, starts, refs, meta, MAX_DIR_BYTES)

  let offset = 0
  while (offset + 38 <= dirData.length) {
    if (entries.length >= MAX_ZIP_TREE_NODES + 64) {
      state.truncated = true
      return
    }
    const tagId = verifyTag(dirData, offset)
    if (tagId !== TAG_FILE_ID) break

    const fileChar = dirData[offset + 18]!
    const nameLen = dirData[offset + 19]!
    const icb = parseLongAd(dirData, offset + 20)
    const implUseLen = dirData.readUInt16LE(offset + 36)
    let totalLen = 38 + implUseLen + nameLen
    totalLen += (4 - (totalLen % 4)) % 4

    const isParent = (fileChar & 0x08) !== 0
    const isDeleted = (fileChar & 0x04) !== 0
    const isDir = (fileChar & 0x02) !== 0

    if (!isParent && !isDeleted && nameLen > 0) {
      const nameStart = offset + 38 + implUseLen
      if (nameStart + nameLen <= dirData.length) {
        const name = decodeUdfName(dirData.subarray(nameStart, nameStart + nameLen)).trim()
        if (name && !name.includes('..') && !name.includes('/') && !name.includes('\\')) {
          const path = prefix ? `${prefix}/${name}` : name
          if (isDir) {
            entries.push({ name: `${path}/`, isDir: true })
            await walkDirectory(
              fh,
              starts,
              refs,
              icb.location,
              icb.partitionRef,
              path,
              entries,
              visited,
              depth + 1,
              state
            )
            if (state.truncated) return
          } else {
            const fileMeta = await readFileEntryMeta(
              fh,
              starts,
              refs,
              icb.location,
              icb.partitionRef
            )
            entries.push({
              name: path,
              isDir: false,
              uncompressedSize: fileMeta?.infoLength
            })
          }
        }
      }
    }

    if (totalLen <= 0) break
    offset += totalLen
  }
}

function parseType1PartitionMaps(lvd: Buffer): PartRefs {
  const mapTableLen = lvd.readUInt32LE(264)
  const numMaps = lvd.readUInt32LE(268)
  const refs: PartRefs = []
  let off = 440
  const end = Math.min(lvd.length, 440 + mapTableLen)
  for (let m = 0; m < numMaps && off + 2 <= end; m++) {
    const type = lvd[off]!
    const len = lvd[off + 1]!
    if (len < 2 || off + len > end) break
    if (type === 1 && len >= 6) {
      refs.push(lvd.readUInt16LE(off + 4))
    } else {
      // Unsupported map (e.g. Type 2 metadata) — keep index alignment with a sentinel.
      refs.push(-1)
    }
    off += len
  }
  return refs
}

async function findAvdp(fh: FileHandle, fileSize: number): Promise<Buffer | null> {
  const candidates: number[] = [...AVDP_SECTORS]
  const totalSectors = Math.floor(fileSize / SECTOR)
  if (totalSectors > 256) candidates.push(totalSectors - 1)
  for (const sector of candidates) {
    try {
      const buf = await readSector(fh, sector)
      if (verifyTag(buf) === TAG_ANCHOR) return buf
    } catch {
      // try next
    }
  }
  return null
}

/** @returns entries when UDF is present and readable; null if no UDF / not usable. */
export async function tryListUdf(fh: FileHandle): Promise<{
  entries: ZipListEntry[]
  truncated: boolean
} | null> {
  const st = await fh.stat()
  const anchor = await findAvdp(fh, st.size)
  if (!anchor) return null

  const mainLen = anchor.readUInt32LE(16)
  const mainLoc = anchor.readUInt32LE(20)
  const sectorCount = Math.max(1, Math.floor(mainLen / SECTOR))

  const starts: PartStarts = new Map()
  const logicalVolumes: { fsd: LongAd; refs: PartRefs }[] = []

  for (let i = 0; i < sectorCount && i < 64; i++) {
    let sector: Buffer
    try {
      sector = await readSector(fh, mainLoc + i)
    } catch {
      break
    }
    const tagId = verifyTag(sector)
    if (tagId == null || tagId === TAG_TERMINATOR) break
    if (tagId === TAG_PARTITION) {
      const partNum = sector.readUInt16LE(22)
      const start = sector.readUInt32LE(188)
      starts.set(partNum, start)
    } else if (tagId === TAG_LOGICAL_VOLUME) {
      logicalVolumes.push({
        fsd: parseLongAd(sector, 248),
        refs: parseType1PartitionMaps(sector)
      })
    }
  }

  if (starts.size === 0 || logicalVolumes.length === 0) return null

  const entries: ZipListEntry[] = []
  const state = { truncated: false }
  const visited = new Set<string>()

  for (const lv of logicalVolumes) {
    const refs = lv.refs.length ? lv.refs : [0]
    // Skip volumes whose FSD partition ref points at an unsupported map type.
    if (partNumberForRef(refs, lv.fsd.partitionRef) < 0) continue

    const fsdOff = partitionByteOffset(starts, refs, lv.fsd.partitionRef, lv.fsd.location)
    let fsd: Buffer
    try {
      fsd = await readAt(fh, fsdOff, SECTOR)
    } catch {
      continue
    }
    if (verifyTag(fsd) !== TAG_FILE_SET) continue
    const rootLoc = fsd.readUInt32LE(404)
    const rootPartRef = fsd.readUInt16LE(408)
    await walkDirectory(fh, starts, refs, rootLoc, rootPartRef, '', entries, visited, 0, state)
    if (entries.length > 0) break
  }

  if (entries.length === 0) return null
  return { entries, truncated: state.truncated }
}
