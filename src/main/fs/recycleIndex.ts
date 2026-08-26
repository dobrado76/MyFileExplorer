import fsp from 'node:fs/promises'
import path from 'node:path'
import { pathExists } from './list'
import { pickRecycleBinTargets, type RecyclePickItem } from './recycleMatch'

function pathKey(p: string): string {
  return p.replace(/[/\\]+$/g, '').toLowerCase()
}

function filetimeToMs(ft: number): number {
  if (!Number.isFinite(ft) || ft <= 0) return 0
  return ft / 10_000 - 11_644_473_600_000
}

function decodeUtf16LeZ(buf: Buffer): string {
  let end = buf.length
  for (let i = 0; i + 1 < buf.length; i += 2) {
    if (buf[i] === 0 && buf[i + 1] === 0) {
      end = i
      break
    }
  }
  if (end === 0) return ''
  return buf.subarray(0, end).toString('utf16le')
}

/** Physical `$Recycle.Bin\…\$R…` store path (not a shell namespace URL). */
export function isRecycleStorePath(p: string): boolean {
  const norm = p.replace(/\//g, '\\')
  return /\\?\$Recycle\.Bin\\/i.test(norm) && /\\\$R[^\\]+$/i.test(norm)
}

/** Map a `$R…` data file to its `$I…` metadata sibling. */
export function recycleDataToMetaPath(recyclePath: string): string | null {
  const base = path.win32.basename(recyclePath)
  if (!/^\$R/i.test(base)) return null
  return path.win32.join(path.win32.dirname(recyclePath), `$I${base.slice(2)}`)
}

/** Parse a Windows Recycle Bin `$I` metadata file (v1 or v2). */
export function parseRecycleMetaBuffer(buf: Buffer): {
  originalPath: string
  deletedMs: number
  size: number
} | null {
  if (buf.length < 0x18) return null
  const version = Number(buf.readBigUInt64LE(0))
  const size = Number(buf.readBigUInt64LE(8))
  const deletedMs = filetimeToMs(Number(buf.readBigUInt64LE(0x10)))

  if (version === 1) {
    if (buf.length < 0x218) return null
    const originalPath = decodeUtf16LeZ(buf.subarray(0x18, 0x18 + 520))
    return originalPath ? { originalPath, deletedMs, size } : null
  }
  if (version === 2) {
    if (buf.length < 0x1c) return null
    const charCount = buf.readUInt32LE(0x18)
    if (charCount <= 0 || charCount > 32_768) return null
    const byteLen = charCount * 2
    if (buf.length < 0x1c + byteLen) return null
    const originalPath = decodeUtf16LeZ(buf.subarray(0x1c, 0x1c + byteLen))
    return originalPath ? { originalPath, deletedMs, size } : null
  }
  return null
}

async function readRecycleMeta(iPath: string): Promise<{
  originalPath: string
  deletedMs: number
  size: number
} | null> {
  try {
    const buf = await fsp.readFile(iPath)
    return parseRecycleMetaBuffer(buf)
  } catch {
    return null
  }
}

/** Build restore targets from known `$R…` store paths (in-app bin selection). */
export async function recycleTargetsFromStorePaths(
  recyclePaths: readonly string[]
): Promise<RecyclePickItem[]> {
  const out: RecyclePickItem[] = []
  for (const rp of recyclePaths) {
    const metaPath = recycleDataToMetaPath(rp)
    if (!metaPath) continue
    const meta = await readRecycleMeta(metaPath)
    if (!meta) continue
    if (!(await pathExists(rp))) continue
    out.push({
      recyclePath: rp,
      originalPath: meta.originalPath,
      dateDeletedMs: meta.deletedMs
    })
  }
  return out
}

function driveRootFor(filePath: string): string | null {
  const parsed = path.win32.parse(filePath.replace(/\//g, '\\'))
  if (!parsed.root) return null
  return parsed.root.endsWith('\\') ? parsed.root : `${parsed.root}\\`
}

/**
 * Resolve original paths (Ctrl+Z undo) by reading `$I` metadata on the source
 * drive only — avoids a full Shell COM listing/walk.
 */
export async function lookupRecycleByOriginal(
  wanted: readonly string[]
): Promise<RecyclePickItem[]> {
  if (wanted.length === 0) return []

  const wantedKeys = new Set(wanted.map(pathKey).filter(Boolean))
  let remaining = wantedKeys.size
  const hits: RecyclePickItem[] = []

  const drives = new Set<string>()
  for (const w of wanted) {
    const root = driveRootFor(w)
    if (root) drives.add(root)
  }
  if (drives.size === 0) drives.add('C:\\')

  for (const driveRoot of drives) {
    const binRoot = path.win32.join(driveRoot, '$Recycle.Bin')
    let sidDirs: string[]
    try {
      sidDirs = await fsp.readdir(binRoot)
    } catch {
      continue
    }

    for (const sid of sidDirs) {
      if (!sid.startsWith('S-')) continue
      const sidDir = path.win32.join(binRoot, sid)
      let names: string[]
      try {
        names = await fsp.readdir(sidDir)
      } catch {
        continue
      }

      for (const name of names) {
        if (!name.startsWith('$I')) continue
        const iPath = path.win32.join(sidDir, name)
        const meta = await readRecycleMeta(iPath)
        if (!meta) continue
        const key = pathKey(meta.originalPath)
        if (!wantedKeys.has(key)) continue

        const rName = `$R${name.slice(2)}`
        const recyclePath = path.win32.join(sidDir, rName)
        if (!(await pathExists(recyclePath))) continue

        hits.push({
          recyclePath,
          originalPath: meta.originalPath,
          dateDeletedMs: meta.deletedMs
        })
        remaining--
        if (remaining <= 0) break
      }
      if (remaining <= 0) break
    }
    if (remaining <= 0) break
  }

  return pickRecycleBinTargets(hits, wanted)
}

export async function resolveRestoreTargets(
  wanted: readonly string[]
): Promise<{ targets: RecyclePickItem[]; missing: string[] }> {
  const storePaths: string[] = []
  const originalPaths: string[] = []
  for (const w of wanted) {
    if (isRecycleStorePath(w)) storePaths.push(w)
    else originalPaths.push(w)
  }

  const fromStore = await recycleTargetsFromStorePaths(storePaths)
  const fromOriginal =
    originalPaths.length > 0 ? await lookupRecycleByOriginal(originalPaths) : []

  const targets = pickRecycleBinTargets([...fromStore, ...fromOriginal], wanted)
  const missing: string[] = []
  for (const w of wanted) {
    const key = pathKey(w)
    const hit = targets.some(
      (t) => pathKey(t.recyclePath) === key || pathKey(t.originalPath) === key
    )
    if (!hit) missing.push(w)
  }
  return { targets, missing }
}
