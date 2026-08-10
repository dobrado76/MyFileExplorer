/**
 * List ISO 9660 / Joliet directory trees via random-access reads (no full-file load).
 * Bundled 7za does not support ISO — do not route `.iso` through sevenZipList.
 */
import fsp from 'node:fs/promises'
import { buildArchiveTreeFromEntries, MAX_ZIP_TREE_NODES, type ZipListEntry } from './zipArchive'
import { tryListUdf } from './udf'

const COOKED_SECTOR = 2048
const RAW_MODE1_SECTOR = 2352
const RAW_MODE1_DATA_OFF = 16 // sync(12) + header(4)

type SectorLayout = {
  /** Bytes between start of successive logical sectors on disk. */
  stride: number
  /** Offset of ISO9660 payload within each physical sector. */
  dataOff: number
  logicalBlockSize: number
}

type DirRec = {
  extentLba: number
  dataLen: number
  isDir: boolean
  name: string
}

async function readAt(
  fh: fsp.FileHandle,
  position: number,
  length: number
): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  const { bytesRead } = await fh.read(buf, 0, length, position)
  if (bytesRead < length) {
    throw new Error('Unexpected end of disc image')
  }
  return buf
}

async function readLogicalSector(
  fh: fsp.FileHandle,
  lba: number,
  layout: SectorLayout
): Promise<Buffer> {
  const pos = lba * layout.stride + layout.dataOff
  return readAt(fh, pos, layout.logicalBlockSize)
}

function isJolietVd(sector: Buffer): boolean {
  // Escape sequences at offset 88 (3 bytes): %@, %C, %E
  const a = sector[88]
  const b = sector[89]
  const c = sector[90]
  return a === 0x25 && b === 0x2f && (c === 0x40 || c === 0x43 || c === 0x45)
}

function parseDirRecord(buf: Buffer, offset: number, joliet: boolean): DirRec | null {
  if (offset >= buf.length) return null
  const len = buf[offset]!
  if (len === 0) return null
  if (offset + len > buf.length || len < 34) return null

  const extentLba = buf.readUInt32LE(offset + 2)
  const dataLen = buf.readUInt32LE(offset + 10)
  const flags = buf[offset + 25]!
  const nameLen = buf[offset + 32]!
  if (offset + 33 + nameLen > buf.length) return null
  const nameRaw = buf.subarray(offset + 33, offset + 33 + nameLen)

  let name: string
  if (nameLen === 1 && nameRaw[0] === 0) name = '.'
  else if (nameLen === 1 && nameRaw[0] === 1) name = '..'
  else if (joliet) {
    name = new TextDecoder('utf-16be').decode(nameRaw)
  } else {
    name = nameRaw.toString('latin1')
    // Strip ISO9660 version suffix `;1`
    const semi = name.indexOf(';')
    if (semi >= 0) name = name.slice(0, semi)
  }

  name = name.replace(/\0/g, '').trim()
  if (!name) return null

  return {
    extentLba,
    dataLen,
    isDir: (flags & 0x02) !== 0,
    name
  }
}

async function readExtent(
  fh: fsp.FileHandle,
  lba: number,
  dataLen: number,
  layout: SectorLayout
): Promise<Buffer> {
  const out = Buffer.alloc(dataLen)
  let written = 0
  let sector = lba
  while (written < dataLen) {
    const block = await readLogicalSector(fh, sector, layout)
    const take = Math.min(layout.logicalBlockSize, dataLen - written)
    block.copy(out, written, 0, take)
    written += take
    sector++
  }
  return out
}

async function walkDirectory(
  fh: fsp.FileHandle,
  rootRec: DirRec,
  prefix: string,
  entries: ZipListEntry[],
  layout: SectorLayout,
  joliet: boolean,
  state: { truncated: boolean }
): Promise<void> {
  if (state.truncated || entries.length >= MAX_ZIP_TREE_NODES + 64) {
    state.truncated = true
    return
  }

  let extent: Buffer
  try {
    extent = await readExtent(fh, rootRec.extentLba, rootRec.dataLen, layout)
  } catch {
    return
  }

  let offset = 0
  while (offset < extent.length) {
    if (extent[offset] === 0) {
      // pad to next sector boundary inside the extent buffer
      const next = Math.ceil((offset + 1) / layout.logicalBlockSize) * layout.logicalBlockSize
      if (next <= offset) break
      offset = next
      continue
    }
    const rec = parseDirRecord(extent, offset, joliet)
    if (!rec) break
    offset += extent[offset]!

    if (rec.name === '.' || rec.name === '..') continue
    if (rec.name.includes('..') || rec.name.includes('/') || rec.name.includes('\\')) continue

    const path = prefix ? `${prefix}/${rec.name}` : rec.name
    entries.push({
      name: rec.isDir ? `${path}/` : path,
      isDir: rec.isDir,
      uncompressedSize: rec.isDir ? undefined : rec.dataLen
    })

    if (entries.length >= MAX_ZIP_TREE_NODES + 64) {
      state.truncated = true
      return
    }

    if (rec.isDir) {
      await walkDirectory(fh, rec, path, entries, layout, joliet, state)
      if (state.truncated) return
    }
  }
}

function rootFromVd(vd: Buffer): DirRec | null {
  return parseDirRecord(vd, 156, false)
}

async function tryListWithLayout(
  fh: fsp.FileHandle,
  layoutHint: Omit<SectorLayout, 'logicalBlockSize'>
): Promise<{ entries: ZipListEntry[]; truncated: boolean } | null> {
  // Probe VD at LBA 16 with assumed 2048 logical blocks first
  let layout: SectorLayout = {
    ...layoutHint,
    logicalBlockSize: COOKED_SECTOR
  }

  let pvd: Buffer | null = null
  let joliet: Buffer | null = null

  for (let lba = 16; lba < 32; lba++) {
    let sector: Buffer
    try {
      sector = await readLogicalSector(fh, lba, layout)
    } catch {
      return null
    }
    if (sector.toString('ascii', 1, 6) !== 'CD001') {
      if (lba === 16) return null
      break
    }
    const type = sector[0]!
    if (type === 1) pvd = sector
    else if (type === 2 && isJolietVd(sector)) joliet = sector
    else if (type === 255) break
  }

  const vd = joliet || pvd
  if (!vd) return null

  const blockSize = vd.readUInt16LE(128)
  if (blockSize !== 512 && blockSize !== 1024 && blockSize !== 2048) return null
  layout = { ...layout, logicalBlockSize: blockSize }

  // Root directory record in PVD/SVD is always encoded as ISO9660 (not UCS-2 name)
  const root = rootFromVd(vd)
  if (!root || !root.isDir) return null

  const entries: ZipListEntry[] = []
  const state = { truncated: false }
  await walkDirectory(fh, root, '', entries, layout, Boolean(joliet), state)
  return { entries, truncated: state.truncated }
}

export async function loadIsoArchiveTree(filePath: string): Promise<{
  tree: ReturnType<typeof buildArchiveTreeFromEntries>['tree']
  truncated: boolean
  fileCount: number
  folderCount: number
}> {
  const fh = await fsp.open(filePath, 'r')
  try {
    // Prefer UDF when present — Windows ISOs expose only a stub README on ISO9660.
    try {
      const udf = await tryListUdf(fh)
      if (udf && udf.entries.length > 0) {
        const built = buildArchiveTreeFromEntries(udf.entries)
        return {
          ...built,
          truncated: built.truncated || udf.truncated
        }
      }
    } catch {
      // fall through to ISO9660 / Joliet
    }

    const layouts: Omit<SectorLayout, 'logicalBlockSize'>[] = [
      { stride: COOKED_SECTOR, dataOff: 0 },
      // Raw Mode-1 CD sectors (common for some .img dumps)
      { stride: RAW_MODE1_SECTOR, dataOff: RAW_MODE1_DATA_OFF }
    ]

    let lastErr: Error | null = null
    for (const hint of layouts) {
      try {
        const listed = await tryListWithLayout(fh, hint)
        if (listed && listed.entries.length > 0) {
          const built = buildArchiveTreeFromEntries(listed.entries)
          return {
            ...built,
            truncated: built.truncated || listed.truncated
          }
        }
        // Empty but valid ISO (rare) — still accept if VD parsed
        if (listed) {
          return buildArchiveTreeFromEntries(listed.entries)
        }
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e))
      }
    }
    throw lastErr ?? new Error('Not a readable ISO 9660 / Joliet / UDF disc image')
  } finally {
    await fh.close()
  }
}
