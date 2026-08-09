import fsp from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { AppError } from '@shared/result'
import { requireAbsolute, pathExists } from './list'
import { uniqueTargetName } from './ops'
import { beginOp } from './opProgress'

/** True when the path looks like a `.zip` archive (by extension). */
export function isZipPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.zip'
}

/**
 * Resolve an archive entry into `destRoot`, or `null` if it would escape (zip-slip).
 */
export function safeZipEntryPath(destRoot: string, entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.endsWith('/')) {
    // directory marker — strip trailing slash for join, caller may mkdir
  }
  const rel = normalized.replace(/\/+$/, '')
  if (!rel) return path.resolve(destRoot)
  const segments = rel.split('/').filter((s) => s.length > 0 && s !== '.')
  if (segments.some((s) => s === '..')) return null
  const target = path.resolve(destRoot, ...segments)
  const rootResolved = path.resolve(destRoot)
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep
  if (target !== rootResolved && !target.toLowerCase().startsWith(prefix.toLowerCase())) {
    return null
  }
  return target
}

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

async function uniqueExtractDir(parent: string, stem: string): Promise<string> {
  let name = stem || 'Archive'
  if (!(await pathExists(path.join(parent, name)))) return path.join(parent, name)
  name = await uniqueTargetName(parent, name)
  return path.join(parent, name)
}

/**
 * Extract one or more `.zip` files into sibling folders named after each archive
 * (Explorer “Extract All…” default: `photo.zip` → `photo\`).
 */
export async function extractZips(zipPaths: string[]): Promise<{ extractedDirs: string[] }> {
  if (zipPaths.length === 0) {
    throw new AppError('validation', 'No archives to extract')
  }

  const absolute = zipPaths.map((p) => requireAbsolute(p))
  for (const p of absolute) {
    if (!isZipPath(p)) {
      throw new AppError('validation', `Not a ZIP file: ${path.basename(p)}`)
    }
    if (!(await pathExists(p))) {
      throw new AppError('not-found', `Not found: ${path.basename(p)}`)
    }
    const st = await fsp.stat(p)
    if (!st.isFile()) {
      throw new AppError('validation', `Not a ZIP file: ${path.basename(p)}`)
    }
  }

  type Planned = {
    zipPath: string
    destDir: string
    zip: JSZip
    files: { entryName: string; target: string }[]
    dirs: string[]
  }
  const planned: Planned[] = []

  for (const zipPath of absolute) {
    const parent = path.dirname(zipPath)
    const stem = path.basename(zipPath, path.extname(zipPath)) || 'Archive'
    const destDir = await uniqueExtractDir(parent, stem)

    let buf: Buffer
    try {
      buf = await fsp.readFile(zipPath)
    } catch {
      throw new AppError('io', `Could not read ${path.basename(zipPath)}`)
    }

    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(buf)
    } catch {
      throw new AppError('io', `Could not open archive: ${path.basename(zipPath)}`)
    }

    const files: { entryName: string; target: string }[] = []
    const dirs = new Set<string>()
    dirs.add(destDir)

    for (const [name, entry] of Object.entries(zip.files)) {
      if (!entry) continue
      const target = safeZipEntryPath(destDir, name)
      if (!target) {
        throw new AppError(
          'not-allowed',
          `Blocked unsafe path in archive: ${name}`,
          'The ZIP contains a path that would write outside the extract folder.'
        )
      }
      if (entry.dir || name.endsWith('/')) {
        dirs.add(target)
        continue
      }
      dirs.add(path.dirname(target))
      files.push({ entryName: name, target })
    }

    planned.push({ zipPath, destDir, zip, files, dirs: [...dirs] })
  }

  const totalFiles = planned.reduce((n, p) => n + p.files.length, 0)
  const progress = beginOp('zip', Math.max(totalFiles, 1), 'Extracting…')
  const extractedDirs: string[] = []

  try {
    for (const job of planned) {
      progress.throwIfCancelled()
      // Create destination root first so cancel mid-extract still leaves a folder to undo.
      await fsp.mkdir(job.destDir, { recursive: true })
      extractedDirs.push(job.destDir)

      const sortedDirs = [...job.dirs].sort((a, b) => a.length - b.length)
      for (const d of sortedDirs) {
        progress.throwIfCancelled()
        await fsp.mkdir(d, { recursive: true })
      }

      if (job.files.length === 0) {
        progress.tick(path.basename(job.zipPath))
        continue
      }

      for (const file of job.files) {
        progress.throwIfCancelled()
        progress.tick(path.basename(file.target))
        const entry = job.zip.file(file.entryName)
        if (!entry) continue
        const data = await entry.async('nodebuffer')
        await fsp.mkdir(path.dirname(file.target), { recursive: true })
        await fsp.writeFile(file.target, data)
      }
    }
    progress.finish()
    return { extractedDirs }
  } catch (e) {
    progress.fail()
    // Leave partial extract for the user to inspect; undo can still delete created roots.
    throw e
  }
}
