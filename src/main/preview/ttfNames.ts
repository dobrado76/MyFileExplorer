/**
 * Read common name-table strings from a TrueType font (no deps).
 */
import fs from 'node:fs'

export type TtfNameInfo = {
  family: string | null
  fullName: string | null
  version: string | null
  copyright: string | null
}

const NAME_COPYRIGHT = 0
const NAME_FAMILY = 1
const NAME_FULL = 4
const NAME_VERSION = 5

const MAX_TTF_SCAN = 8 * 1024 * 1024

function readNameTable(buf: Buffer): TtfNameInfo {
  const empty: TtfNameInfo = { family: null, fullName: null, version: null, copyright: null }
  if (buf.length < 12) return empty

  const scaler = buf.readUInt32BE(0)
  // 0x00010000 TrueType, 'OTTO' CFF, 'true' / 'typ1'
  if (scaler !== 0x00010000 && scaler !== 0x4f54544f && scaler !== 0x74727565) {
    return empty
  }

  const numTables = buf.readUInt16BE(4)
  if (numTables > 64 || 12 + numTables * 16 > buf.length) return empty

  let nameOffset = 0
  let nameLength = 0
  for (let i = 0; i < numTables; i++) {
    const entry = 12 + i * 16
    const tag = buf.toString('ascii', entry, entry + 4)
    if (tag === 'name') {
      nameOffset = buf.readUInt32BE(entry + 8)
      nameLength = buf.readUInt32BE(entry + 12)
      break
    }
  }
  if (!nameOffset || !nameLength || nameOffset + nameLength > buf.length) return empty

  const name = buf.subarray(nameOffset, nameOffset + nameLength)
  if (name.length < 6) return empty
  const format = name.readUInt16BE(0)
  if (format > 1) return empty
  const count = name.readUInt16BE(2)
  const stringOffset = name.readUInt16BE(4)
  if (6 + count * 12 > name.length) return empty

  type Cand = { platform: number; language: number; value: string }
  const byId = new Map<number, Cand[]>()

  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12
    const platformID = name.readUInt16BE(rec)
    const languageID = name.readUInt16BE(rec + 4)
    const nameID = name.readUInt16BE(rec + 6)
    const length = name.readUInt16BE(rec + 8)
    const offset = name.readUInt16BE(rec + 10)
    if (
      nameID !== NAME_COPYRIGHT &&
      nameID !== NAME_FAMILY &&
      nameID !== NAME_FULL &&
      nameID !== NAME_VERSION
    ) {
      continue
    }
    const abs = stringOffset + offset
    if (abs + length > name.length || length === 0) continue
    const raw = name.subarray(abs, abs + length)
    let value: string
    if (platformID === 0 || platformID === 3) {
      value = new TextDecoder('utf-16be').decode(raw)
    } else if (platformID === 1) {
      value = raw.toString('latin1')
    } else {
      continue
    }
    value = value.replace(/\0/g, '').trim()
    if (!value) continue
    const list = byId.get(nameID) ?? []
    list.push({ platform: platformID, language: languageID, value })
    byId.set(nameID, list)
  }

  const pick = (nameID: number): string | null => {
    const list = byId.get(nameID)
    if (!list?.length) return null
    // Prefer Windows English, then any Windows, then Unicode, then Mac
    const rank = (c: Cand): number => {
      if (c.platform === 3 && (c.language === 0x0409 || c.language === 0x009)) return 0
      if (c.platform === 3) return 1
      if (c.platform === 0) return 2
      return 3
    }
    return [...list].sort((a, b) => rank(a) - rank(b))[0]?.value ?? null
  }

  return {
    copyright: pick(NAME_COPYRIGHT),
    family: pick(NAME_FAMILY),
    fullName: pick(NAME_FULL),
    version: pick(NAME_VERSION)
  }
}

export function readTtfNames(filePath: string): TtfNameInfo {
  const fd = fs.openSync(filePath, 'r')
  try {
    const st = fs.fstatSync(fd)
    const size = Math.min(st.size, MAX_TTF_SCAN)
    const buf = Buffer.alloc(size)
    fs.readSync(fd, buf, 0, size, 0)
    return readNameTable(buf)
  } finally {
    fs.closeSync(fd)
  }
}
