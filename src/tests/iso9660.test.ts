import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadIsoArchiveTree } from '../main/preview/iso9660'

const SECTOR = 2048
const temps: string[] = []

afterEach(async () => {
  for (const p of temps.splice(0)) {
    await fsp.unlink(p).catch(() => undefined)
  }
})

function writeBothEndian32(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt32LE(value, offset)
  buf.writeUInt32BE(value, offset + 4)
}

function writeBothEndian16(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt16LE(value, offset)
  buf.writeUInt16BE(value, offset + 2)
}

function dirRecord(opts: {
  lba: number
  size: number
  isDir: boolean
  name: Buffer
}): Buffer {
  const nameLen = opts.name.length
  const len = 33 + nameLen + ((nameLen + 1) % 2) // pad to even
  const buf = Buffer.alloc(len, 0)
  buf[0] = len
  writeBothEndian32(buf, 2, opts.lba)
  writeBothEndian32(buf, 10, opts.size)
  buf[25] = opts.isDir ? 0x02 : 0x00
  buf[32] = nameLen
  opts.name.copy(buf, 33)
  return buf
}

/** Tiny cooked ISO9660: one file HELLO.TXT at root. */
async function writeMinimalIso(): Promise<string> {
  const rootLba = 20
  const fileLba = 21
  const fileData = Buffer.from('hello')
  const sectors = 22
  const image = Buffer.alloc(sectors * SECTOR, 0)

  // Primary Volume Descriptor @ LBA 16
  const pvd = image.subarray(16 * SECTOR, 17 * SECTOR)
  pvd[0] = 1
  pvd.write('CD001', 1, 5, 'ascii')
  pvd[6] = 1
  pvd.write('TESTISO'.padEnd(32, ' '), 40, 32, 'ascii')
  writeBothEndian32(pvd, 80, sectors)
  writeBothEndian16(pvd, 128, SECTOR)

  const rootRec = dirRecord({
    lba: rootLba,
    size: SECTOR,
    isDir: true,
    name: Buffer.from([0])
  })
  rootRec.copy(pvd, 156)

  // Terminator @ LBA 17
  const term = image.subarray(17 * SECTOR, 18 * SECTOR)
  term[0] = 255
  term.write('CD001', 1, 5, 'ascii')
  term[6] = 1

  // Root directory @ LBA 20
  const rootDir = image.subarray(rootLba * SECTOR, (rootLba + 1) * SECTOR)
  let off = 0
  const dot = dirRecord({ lba: rootLba, size: SECTOR, isDir: true, name: Buffer.from([0]) })
  const dotdot = dirRecord({ lba: rootLba, size: SECTOR, isDir: true, name: Buffer.from([1]) })
  const file = dirRecord({
    lba: fileLba,
    size: fileData.length,
    isDir: false,
    name: Buffer.from('HELLO.TXT;1', 'ascii')
  })
  for (const rec of [dot, dotdot, file]) {
    rec.copy(rootDir, off)
    off += rec.length
  }

  fileData.copy(image, fileLba * SECTOR)

  const tmp = path.join(os.tmpdir(), `mfe-iso-test-${Date.now()}.iso`)
  await fsp.writeFile(tmp, image)
  temps.push(tmp)
  return tmp
}

describe('loadIsoArchiveTree', () => {
  it('lists files from a minimal ISO 9660 image', async () => {
    const iso = await writeMinimalIso()
    const listed = await loadIsoArchiveTree(iso)
    expect(listed.fileCount).toBe(1)
    expect(listed.tree.some((n) => n.name === 'HELLO.TXT' || n.path === 'HELLO.TXT')).toBe(true)
  })

  it('rejects non-ISO data', async () => {
    const tmp = path.join(os.tmpdir(), `mfe-iso-bad-${Date.now()}.img`)
    await fsp.writeFile(tmp, Buffer.alloc(4096, 0x5a))
    temps.push(tmp)
    await expect(loadIsoArchiveTree(tmp)).rejects.toThrow(/ISO 9660/i)
  })
})
