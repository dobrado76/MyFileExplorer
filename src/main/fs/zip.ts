import fsp from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { AppError } from '@shared/result'
import { requireAbsolute, pathExists } from './list'
import { uniqueTargetName } from './ops'
import { beginOp } from './opProgress'

type ZipSourceEntry =
  | { kind: 'file'; diskPath: string; zipPath: string }
  | { kind: 'dir'; zipPath: string }

/** Explorer-style archive stem for the destination `.zip` name (no extension). */
export function zipArchiveStem(sources: string[], singleIsDir: boolean): string {
  if (sources.length === 1) {
    const base = path.basename(sources[0]!)
    if (singleIsDir) return base || 'Archive'
    const ext = path.extname(base)
    const stem = ext ? base.slice(0, base.length - ext.length) : base
    return stem || 'Archive'
  }
  const parent = path.basename(path.dirname(sources[0]!))
  return parent || 'Archive'
}

function commonParentDir(absolute: string[]): string | null {
  if (absolute.length === 0) return null
  const parents = absolute.map((p) => path.dirname(p))
  const first = parents[0]!
  for (let i = 1; i < parents.length; i++) {
    if (path.resolve(parents[i]!).toLowerCase() !== path.resolve(first).toLowerCase()) {
      return null
    }
  }
  return first
}

async function collectEntries(src: string): Promise<ZipSourceEntry[]> {
  const root = requireAbsolute(src)
  const st = await fsp.stat(root)
  const rootName = path.basename(root)
  if (!st.isDirectory()) {
    return [{ kind: 'file', diskPath: root, zipPath: rootName.replace(/\\/g, '/') }]
  }

  const out: ZipSourceEntry[] = []
  const walk = async (dir: string, zipPrefix: string): Promise<void> => {
    let kids
    try {
      kids = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      throw new AppError('io', `Could not read folder: ${path.basename(dir)}`)
    }
    if (kids.length === 0) {
      out.push({ kind: 'dir', zipPath: zipPrefix.replace(/\\/g, '/') + '/' })
      return
    }
    for (const kid of kids) {
      const full = path.join(dir, kid.name)
      const zp = `${zipPrefix}/${kid.name}`.replace(/\\/g, '/')
      if (kid.isDirectory()) await walk(full, zp)
      else if (kid.isFile() || kid.isSymbolicLink()) {
        out.push({ kind: 'file', diskPath: full, zipPath: zp })
      }
    }
  }
  await walk(root, rootName)
  return out
}

/**
 * Create a `.zip` next to the selection (Explorer “Compress to ZIP file”).
 * - One file → `Name.zip` (last extension stripped)
 * - One folder → `FolderName.zip`
 * - Multiple → `{parentFolder}.zip`
 */
export async function compressToZip(sources: string[]): Promise<{ zipPath: string }> {
  if (sources.length === 0) {
    throw new AppError('validation', 'No items to compress')
  }

  const absolute = sources.map((s) => requireAbsolute(s))
  for (const p of absolute) {
    if (!(await pathExists(p))) {
      throw new AppError('not-found', `Not found: ${path.basename(p)}`)
    }
  }

  const destDir = commonParentDir(absolute) ?? path.dirname(absolute[0]!)
  let destStat
  try {
    destStat = await fsp.stat(destDir)
  } catch {
    throw new AppError('not-found', 'Destination folder not found')
  }
  if (!destStat.isDirectory()) {
    throw new AppError('validation', 'Destination must be a folder')
  }

  const firstStat = await fsp.stat(absolute[0]!)
  const stem = zipArchiveStem(absolute, firstStat.isDirectory())
  let zipName = `${stem}.zip`
  if (await pathExists(path.join(destDir, zipName))) {
    zipName = await uniqueTargetName(destDir, zipName)
  }
  const zipPath = path.join(destDir, zipName)

  // Don't pack the archive into itself if the user somehow re-selects it mid-op.
  const sourcesToPack = absolute.filter(
    (p) => path.resolve(p).toLowerCase() !== path.resolve(zipPath).toLowerCase()
  )
  if (sourcesToPack.length === 0) {
    throw new AppError('validation', 'Nothing to compress')
  }

  const entries: ZipSourceEntry[] = []
  for (const src of sourcesToPack) {
    entries.push(...(await collectEntries(src)))
  }

  const fileCount = entries.filter((e) => e.kind === 'file').length
  const progress = beginOp('zip', Math.max(fileCount, 1), 'Compressing…')
  const zip = new JSZip()

  try {
    if (fileCount === 0) {
      // Only empty folders — still produce a valid archive.
      for (const e of entries) {
        if (e.kind === 'dir') zip.folder(e.zipPath.replace(/\/$/, ''))
      }
      progress.tick(path.basename(zipPath))
    } else {
      for (const e of entries) {
        progress.throwIfCancelled()
        if (e.kind === 'dir') {
          zip.folder(e.zipPath.replace(/\/$/, ''))
          continue
        }
        progress.tick(path.basename(e.diskPath))
        const data = await fsp.readFile(e.diskPath)
        zip.file(e.zipPath, data)
      }
    }

    progress.throwIfCancelled()
    progress.pulse(path.basename(zipPath))
    const buf = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    })
    progress.throwIfCancelled()
    await fsp.writeFile(zipPath, buf)
    progress.finish()
    return { zipPath }
  } catch (e) {
    progress.fail()
    await fsp.unlink(zipPath).catch(() => {})
    throw e
  }
}
