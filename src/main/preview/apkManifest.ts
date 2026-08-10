/**
 * Read package / version from an APK's binary AndroidManifest.xml (ZIP entry only).
 */
import yauzl from 'yauzl'

export type ApkManifestInfo = {
  packageName: string | null
  versionName: string | null
  versionCode: string | null
}

const RES_STRING_POOL_TYPE = 0x0001
const RES_XML_START_ELEMENT_TYPE = 0x0102
const TYPE_STRING = 0x03
const TYPE_INT_DEC = 0x10
const TYPE_INT_HEX = 0x11

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024

function readZipEntry(filePath: string, entryName: string): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('Could not open APK'))
        return
      }
      let settled = false
      const done = (buf: Buffer | null): void => {
        if (settled) return
        settled = true
        try {
          zipfile.close()
        } catch {
          // closing
        }
        resolve(buf)
      }
      zipfile.readEntry()
      zipfile.on('entry', (entry) => {
        if (settled) return
        if (entry.fileName !== entryName) {
          zipfile.readEntry()
          return
        }
        if (entry.uncompressedSize > MAX_MANIFEST_BYTES) {
          done(null)
          return
        }
        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            done(null)
            return
          }
          const chunks: Buffer[] = []
          let total = 0
          stream.on('data', (c: Buffer) => {
            total += c.length
            if (total > MAX_MANIFEST_BYTES) {
              stream.destroy()
              done(null)
              return
            }
            chunks.push(c)
          })
          stream.on('end', () => done(Buffer.concat(chunks)))
          stream.on('error', () => done(null))
        })
      })
      zipfile.on('end', () => done(null))
      zipfile.on('error', (e) => {
        if (settled) return
        settled = true
        reject(e)
      })
    })
  })
}

function readStringPool(buf: Buffer, poolOffset: number): string[] | null {
  if (poolOffset + 28 > buf.length) return null
  const type = buf.readUInt16LE(poolOffset)
  if (type !== RES_STRING_POOL_TYPE) return null
  const headerSize = buf.readUInt16LE(poolOffset + 2)
  const chunkSize = buf.readUInt32LE(poolOffset + 4)
  if (headerSize < 28 || poolOffset + chunkSize > buf.length) return null

  const stringCount = buf.readUInt32LE(poolOffset + 8)
  const flags = buf.readUInt32LE(poolOffset + 16)
  const stringsStart = buf.readUInt32LE(poolOffset + 20)
  const utf8 = (flags & (1 << 8)) !== 0

  if (stringCount > 100_000) return null
  const offsetsStart = poolOffset + headerSize
  if (offsetsStart + stringCount * 4 > buf.length) return null

  const dataBase = poolOffset + stringsStart
  const strings: string[] = []
  for (let i = 0; i < stringCount; i++) {
    const off = buf.readUInt32LE(offsetsStart + i * 4)
    const at = dataBase + off
    if (at >= buf.length) {
      strings.push('')
      continue
    }
    try {
      if (utf8) {
        // UTF-8: u8/u16 charLen, u8/u16 byteLen, then bytes, then 0
        let p = at
        const charLenMark = buf[p++]
        if (charLenMark === undefined) {
          strings.push('')
          continue
        }
        if (charLenMark & 0x80) p++ // skip high char-len byte
        let byteLen = buf[p++]
        if (byteLen === undefined) {
          strings.push('')
          continue
        }
        if (byteLen & 0x80) {
          const lo = buf[p++]
          if (lo === undefined) {
            strings.push('')
            continue
          }
          byteLen = ((byteLen & 0x7f) << 8) | lo
        }
        if (p + byteLen > buf.length) {
          strings.push('')
          continue
        }
        strings.push(buf.subarray(p, p + byteLen).toString('utf8'))
      } else {
        // UTF-16LE: u16 charLen (or 2×u16 if high bit), then chars, then 0
        let p = at
        let charLen = buf.readUInt16LE(p)
        p += 2
        if (charLen & 0x8000) {
          charLen = ((charLen & 0x7fff) << 16) | buf.readUInt16LE(p)
          p += 2
        }
        const byteLen = charLen * 2
        if (p + byteLen > buf.length) {
          strings.push('')
          continue
        }
        strings.push(buf.subarray(p, p + byteLen).toString('utf16le'))
      }
    } catch {
      strings.push('')
    }
  }
  return strings
}

function poolString(strings: string[], index: number): string | null {
  if (index < 0 || index >= strings.length) return null
  const s = strings[index]
  return s || null
}

function attrValue(
  buf: Buffer,
  attrOffset: number,
  strings: string[]
): string | null {
  // ns, name, rawValue, size|res0|dataType, data — 20 bytes
  const rawValue = buf.readInt32LE(attrOffset + 8)
  const dataType = buf.readUInt8(attrOffset + 15)
  const data = buf.readUInt32LE(attrOffset + 16)
  if (dataType === TYPE_STRING) {
    const idx = rawValue >= 0 ? rawValue : data
    return poolString(strings, idx)
  }
  if (dataType === TYPE_INT_DEC || dataType === TYPE_INT_HEX) {
    return String(data >>> 0)
  }
  if (rawValue >= 0) return poolString(strings, rawValue)
  return null
}

/** Parse binary AXML buffer for manifest package / version attributes. */
export function parseBinaryAndroidManifest(buf: Buffer): ApkManifestInfo {
  const empty: ApkManifestInfo = { packageName: null, versionName: null, versionCode: null }
  if (buf.length < 8) return empty
  // File header: type 0x0003 (XML), then chunks
  const fileType = buf.readUInt16LE(0)
  if (fileType !== 0x0003) return empty

  const strings = readStringPool(buf, 8)
  if (!strings) return empty

  let offset = 8
  const fileSize = Math.min(buf.readUInt32LE(4), buf.length)
  let packageName: string | null = null
  let versionName: string | null = null
  let versionCode: string | null = null

  while (offset + 8 <= fileSize) {
    const chunkType = buf.readUInt16LE(offset)
    const chunkSize = buf.readUInt32LE(offset + 4)
    if (chunkSize < 8 || offset + chunkSize > fileSize) break

    if (chunkType === RES_XML_START_ELEMENT_TYPE) {
      // After ResXMLTree_node (header 8 + line 4 + comment 4 = 16 from chunk start for standard)
      // headerSize is usually 16 for node; then ns+name (8) + attrStart/attrSize/count/...
      const headerSize = buf.readUInt16LE(offset + 2)
      const nodeBase = offset
      // ResXMLTree_attrExt starts after ResXMLTree_node
      const ext = nodeBase + headerSize
      if (ext + 20 > offset + chunkSize) {
        offset += chunkSize
        continue
      }
      const nameIdx = buf.readInt32LE(ext + 4)
      const elName = poolString(strings, nameIdx)
      const attrStart = buf.readUInt16LE(ext + 8)
      const attrSize = buf.readUInt16LE(ext + 10)
      const attrCount = buf.readUInt16LE(ext + 12)
      if (elName === 'manifest' && attrSize >= 20 && attrCount > 0) {
        const attrsAt = ext + attrStart
        for (let i = 0; i < attrCount; i++) {
          const a = attrsAt + i * attrSize
          if (a + attrSize > offset + chunkSize) break
          const attrNameIdx = buf.readInt32LE(a + 4)
          const attrName = poolString(strings, attrNameIdx)
          const value = attrValue(buf, a, strings)
          if (!attrName || value == null || value === '') continue
          if (attrName === 'package') packageName = value
          else if (attrName === 'versionName') versionName = value
          else if (attrName === 'versionCode') versionCode = value
        }
        break
      }
    }
    offset += chunkSize
  }

  return { packageName, versionName, versionCode }
}

export async function readApkManifestInfo(apkPath: string): Promise<ApkManifestInfo> {
  const buf = await readZipEntry(apkPath, 'AndroidManifest.xml')
  if (!buf) return { packageName: null, versionName: null, versionCode: null }
  return parseBinaryAndroidManifest(buf)
}
