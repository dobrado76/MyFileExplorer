import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '@shared/result'
import { requireAbsolute } from '../list'
import { bestFileName, type ParsedFileRecord } from './mftParse'
import {
  buildMftLayout,
  letterOf,
  pathHintToRelativeSegments,
  readFileRecordAt,
  resolveParentPath,
  sanitizeRecoverSegment,
  type DirEntry,
  type MftLayout
} from './scan'
import { decodeUndeleteToken } from './token'
import {
  closeHandle,
  getNtfsVolumeData,
  needsUsnElevation,
  openVolumeHandle,
  readVolume
} from './volume'

export type RecoverProgress = (done: number, total: number, currentName: string) => void

function readStreamBytes(
  handle: unknown,
  bytesPerCluster: number,
  bytesPerSector: number,
  rec: ParsedFileRecord
): Buffer | null {
  const d = rec.data
  if (!d) return null
  if (d.encrypted || d.compressed) return null
  if (d.resident) {
    return d.residentData ? Buffer.from(d.residentData) : Buffer.alloc(0)
  }
  if (d.runs.length === 0) return null
  // Cap absurd sizes from damaged records (Node Buffer max ~2 GiB).
  if (!Number.isFinite(d.size) || d.size < 0 || d.size > 0x7fffffff) return null
  const out = Buffer.alloc(Math.max(0, d.size))
  let written = 0
  for (const run of d.runs) {
    if (written >= out.length) break
    const runBytes = run.length * bytesPerCluster
    const need = Math.min(runBytes, out.length - written)
    if (run.lcn == null) {
      written += need
      continue
    }
    const off = BigInt(run.lcn) * BigInt(bytesPerCluster)
    // Raw volume ReadFile requires sector-aligned length — readVolume handles that.
    const chunk = readVolume(handle, off, need, bytesPerSector)
    if (!chunk || chunk.length === 0) return written > 0 ? out.subarray(0, written) : null
    chunk.copy(out, written, 0, Math.min(chunk.length, need))
    written += Math.min(chunk.length, need)
    if (chunk.length < need) return out.subarray(0, written)
  }
  return out
}

function displayName(parsed: ParsedFileRecord, recordIndex: number): string {
  return (
    parsed.fileNames.find((n) => n.namespace === 1 || n.namespace === 3)?.name ??
    parsed.fileNames[0]?.name ??
    `file_${recordIndex}`
  )
}

function loadDirEntry(
  handle: unknown,
  layout: MftLayout,
  idx: number
): DirEntry | undefined {
  const parsed = readFileRecordAt(handle, layout, idx)
  if (!parsed) return undefined
  const fn = bestFileName(parsed.fileNames)
  if (!fn) return undefined
  // Prefer real directories; still use a name if the parent record lost the dir flag.
  if (!parsed.isDirectory && !fn.name) return undefined
  return { name: fn.name, parentFrn: fn.parentFrn, inUse: parsed.inUse }
}

/** Unique path under `dir` for `fileName` (`name (2).ext` when taken). */
function uniqueDestFile(dir: string, fileName: string): string {
  const safeName = sanitizeRecoverSegment(fileName)
  let dest = path.join(dir, safeName)
  const ext = path.extname(safeName)
  const stem = ext ? safeName.slice(0, -ext.length) : safeName
  let n = 2
  for (;;) {
    try {
      fs.accessSync(dest)
      dest = path.join(dir, `${stem} (${n++})${ext}`)
    } catch {
      return dest
    }
  }
}

export type RecoverSessionState = {
  layout: MftLayout
  dirs: Map<number, DirEntry>
}

export async function recoverTokensOnHandle(
  handle: unknown,
  volume: string,
  tokens: string[],
  destDirRaw: string,
  opts?: {
    onProgress?: RecoverProgress
    signal?: AbortSignal
    /** Reuse MFT layout + parent-dir cache across chunks. */
    session?: RecoverSessionState
    progressOffset?: number
    progressTotal?: number
  }
): Promise<{
  recovered: { token: string; path: string }[]
  failed: { token: string; message: string }[]
  session: RecoverSessionState
}> {
  const destDir = requireAbsolute(destDirRaw)
  const recovered: { token: string; path: string }[] = []
  const failed: { token: string; message: string }[] = []
  const offset = opts?.progressOffset ?? 0
  const total = opts?.progressTotal ?? tokens.length
  let session = opts?.session
  if (!session) {
    const volRes = getNtfsVolumeData(handle)
    if (!volRes.data) {
      for (const token of tokens) {
        failed.push({
          token,
          message: needsUsnElevation(volRes.err)
            ? 'Need administrator to read this volume'
            : `Could not read volume data (error ${volRes.err})`
        })
      }
      throw new AppError(
        'io',
        needsUsnElevation(volRes.err)
          ? 'Need administrator to read this volume'
          : `Could not read volume data (error ${volRes.err})`
      )
    }
    opts?.onProgress?.(offset, total, 'Mapping $MFT…')
    session = { layout: buildMftLayout(handle, volRes.data), dirs: new Map() }
  }
  const letter = letterOf(volume)
  const { layout, dirs } = session
  let lastProgressMs = 0
  for (let i = 0; i < tokens.length; i++) {
    if (opts?.signal?.aborted) {
      for (const rest of tokens.slice(i)) failed.push({ token: rest, message: 'Cancelled' })
      break
    }
    const abs = offset + i
    const now = Date.now()
    if (i === 0 || now - lastProgressMs >= 80) {
      lastProgressMs = now
      opts?.onProgress?.(abs, total, '')
    }
    const one = recoverOneSync(handle, layout, letter, tokens[i]!, destDir, dirs)
    if (now - lastProgressMs >= 80 || i === tokens.length - 1) {
      lastProgressMs = Date.now()
      opts?.onProgress?.(abs + 1, total, one.name)
    }
    if (one.ok) recovered.push({ token: tokens[i]!, path: one.path })
    else failed.push({ token: tokens[i]!, message: one.message })
    await new Promise<void>((r) => setImmediate(r))
  }
  return { recovered, failed, session }
}

function recoverOneSync(
  handle: unknown,
  layout: MftLayout,
  letter: string,
  token: string,
  destDir: string,
  dirs: Map<number, DirEntry>
): { ok: true; path: string; name: string } | { ok: false; message: string; name: string } {
  const decoded = decodeUndeleteToken(token)
  if (!decoded || decoded.letter !== letter) {
    return { ok: false, message: 'Invalid recover token', name: '?' }
  }
  const parsed = readFileRecordAt(handle, layout, decoded.recordIndex)
  const name = parsed ? displayName(parsed, decoded.recordIndex) : `file_${decoded.recordIndex}`
  if (!parsed) return { ok: false, message: 'FILE record not found', name }
  if (parsed.sequence !== decoded.sequence) {
    return { ok: false, message: 'FILE record was reused (sequence mismatch)', name }
  }
  if (parsed.inUse) return { ok: false, message: 'Record is in use again', name }
  if (parsed.isDirectory) {
    return { ok: false, message: 'Directories are not recovered in this version', name }
  }
  const bytes = readStreamBytes(
    handle,
    layout.vol.bytesPerCluster,
    layout.vol.bytesPerSector,
    parsed
  )
  if (!bytes) {
    return {
      ok: false,
      message: 'Could not read file data (overwritten, encrypted, or compressed)',
      name
    }
  }
  const fn = bestFileName(parsed.fileNames)
  const pathHint = fn
    ? resolveParentPath(fn.parentFrn, dirs, letter, (idx) => loadDirEntry(handle, layout, idx))
    : null
  const relSegs = pathHintToRelativeSegments(pathHint, letter)
  const targetDir = relSegs.length > 0 ? path.join(destDir, ...relSegs) : destDir
  try {
    fs.mkdirSync(targetDir, { recursive: true })
    const dest = uniqueDestFile(targetDir, name)
    fs.writeFileSync(dest, bytes)
    return { ok: true, path: dest, name }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), name }
  }
}

/** Sync recover for elevated CLI (no async). */
export function recoverTokensOnHandleSync(
  handle: unknown,
  volume: string,
  tokens: string[],
  destDirRaw: string
): {
  recovered: { token: string; path: string }[]
  failed: { token: string; message: string }[]
} {
  const destDir = requireAbsolute(destDirRaw)
  const recovered: { token: string; path: string }[] = []
  const failed: { token: string; message: string }[] = []
  const volRes = getNtfsVolumeData(handle)
  if (!volRes.data) {
    for (const token of tokens) {
      failed.push({
        token,
        message: needsUsnElevation(volRes.err)
          ? 'Need administrator to read this volume'
          : `Could not read volume data (error ${volRes.err})`
      })
    }
    return { recovered, failed }
  }
  const layout = buildMftLayout(handle, volRes.data)
  const letter = letterOf(volume)
  const dirs = new Map<number, DirEntry>()
  for (const token of tokens) {
    const one = recoverOneSync(handle, layout, letter, token, destDir, dirs)
    if (one.ok) recovered.push({ token, path: one.path })
    else failed.push({ token, message: one.message })
  }
  return { recovered, failed }
}

export function openVolumeForUndelete(volume: string): {
  handle: unknown | null
  err: number
  needsElevation: boolean
} {
  const letter = letterOf(volume)
  const opened = openVolumeHandle(letter, false)
  return {
    handle: opened.handle,
    err: opened.err,
    needsElevation: !opened.handle && needsUsnElevation(opened.err)
  }
}

export { closeHandle }
