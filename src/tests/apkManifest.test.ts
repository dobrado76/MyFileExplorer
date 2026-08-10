import { describe, expect, it } from 'vitest'
import { parseBinaryAndroidManifest } from '../main/preview/apkManifest'

/** Build a minimal binary AndroidManifest with package / version attrs. */
function buildMinimalManifestAxm(opts: {
  packageName: string
  versionName: string
  versionCode: number
}): Buffer {
  const strings = [
    'manifest',
    'package',
    'versionName',
    'versionCode',
    opts.packageName,
    opts.versionName
  ]
  // UTF-16LE string pool
  const strChunks: Buffer[] = []
  const offsets: number[] = []
  let dataPos = 0
  for (const s of strings) {
    offsets.push(dataPos)
    const chars = Buffer.from(s, 'utf16le')
    const header = Buffer.alloc(2)
    header.writeUInt16LE(s.length, 0)
    const nul = Buffer.alloc(2)
    strChunks.push(header, chars, nul)
    dataPos += header.length + chars.length + nul.length
  }
  const stringData = Buffer.concat(strChunks)
  const stringCount = strings.length
  const headerSize = 28
  const offsetsSize = stringCount * 4
  const stringsStart = headerSize + offsetsSize
  const poolSize = stringsStart + stringData.length
  // align pool to 4
  const poolPad = (4 - (poolSize % 4)) % 4
  const poolChunkSize = poolSize + poolPad

  const pool = Buffer.alloc(poolChunkSize)
  pool.writeUInt16LE(0x0001, 0) // RES_STRING_POOL_TYPE
  pool.writeUInt16LE(headerSize, 2)
  pool.writeUInt32LE(poolChunkSize, 4)
  pool.writeUInt32LE(stringCount, 8)
  pool.writeUInt32LE(0, 12) // styleCount
  pool.writeUInt32LE(0, 16) // flags UTF-16
  pool.writeUInt32LE(stringsStart, 20)
  pool.writeUInt32LE(0, 24) // stylesStart
  for (let i = 0; i < stringCount; i++) {
    pool.writeUInt32LE(offsets[i]!, headerSize + i * 4)
  }
  stringData.copy(pool, stringsStart)

  // Start element chunk
  const attrCount = 3
  const attrSize = 20
  const attrStart = 20 // from attrExt
  const nodeHeaderSize = 16
  const attrExtSize = attrStart + attrCount * attrSize
  const startChunkSize = nodeHeaderSize + attrExtSize
  const start = Buffer.alloc(startChunkSize)
  start.writeUInt16LE(0x0102, 0) // START_ELEMENT
  start.writeUInt16LE(nodeHeaderSize, 2)
  start.writeUInt32LE(startChunkSize, 4)
  start.writeUInt32LE(1, 8) // line
  start.writeInt32LE(-1, 12) // comment
  // attrExt at 16
  start.writeInt32LE(-1, 16) // ns
  start.writeInt32LE(0, 20) // name = "manifest"
  start.writeUInt16LE(attrStart, 24)
  start.writeUInt16LE(attrSize, 26)
  start.writeUInt16LE(attrCount, 28)
  start.writeUInt16LE(0, 30)
  start.writeUInt16LE(0, 32)
  start.writeUInt16LE(0, 34)

  const writeAttr = (index: number, nameIdx: number, rawOrType: 'string' | 'int', valueIdxOrInt: number): void => {
    const a = nodeHeaderSize + attrStart + index * attrSize
    start.writeInt32LE(-1, a) // ns
    start.writeInt32LE(nameIdx, a + 4)
    if (rawOrType === 'string') {
      start.writeInt32LE(valueIdxOrInt, a + 8) // rawValue
      start.writeUInt16LE(8, a + 12) // size
      start.writeUInt8(0, a + 14)
      start.writeUInt8(0x03, a + 15) // TYPE_STRING
      start.writeUInt32LE(valueIdxOrInt, a + 16)
    } else {
      start.writeInt32LE(-1, a + 8)
      start.writeUInt16LE(8, a + 12)
      start.writeUInt8(0, a + 14)
      start.writeUInt8(0x10, a + 15) // TYPE_INT_DEC
      start.writeUInt32LE(valueIdxOrInt, a + 16)
    }
  }
  writeAttr(0, 1, 'string', 4) // package
  writeAttr(1, 2, 'string', 5) // versionName
  writeAttr(2, 3, 'int', opts.versionCode)

  const totalSize = 8 + poolChunkSize + startChunkSize
  const out = Buffer.alloc(totalSize)
  out.writeUInt16LE(0x0003, 0) // RES_XML_TYPE
  out.writeUInt16LE(8, 2)
  out.writeUInt32LE(totalSize, 4)
  pool.copy(out, 8)
  start.copy(out, 8 + poolChunkSize)
  return out
}

describe('parseBinaryAndroidManifest', () => {
  it('reads package, versionName, and versionCode', () => {
    const buf = buildMinimalManifestAxm({
      packageName: 'com.example.app',
      versionName: '1.2.3',
      versionCode: 42
    })
    const info = parseBinaryAndroidManifest(buf)
    expect(info.packageName).toBe('com.example.app')
    expect(info.versionName).toBe('1.2.3')
    expect(info.versionCode).toBe('42')
  })

  it('returns nulls for non-AXML', () => {
    const info = parseBinaryAndroidManifest(Buffer.from('<?xml version="1.0"?>'))
    expect(info.packageName).toBeNull()
  })
})
