import fsp from 'node:fs/promises'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { AppError } from '@shared/result'
import { requireAbsolute, pathExists } from './list'
import { uniqueTargetName } from './ops'
import { beginOp, cancelledError, type OpReporter } from './opProgress'
import { resolve7zaPath } from './sevenZipBin'

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

/** Parse 7za `-bsp1` progress lines (`\r  45%` / `45% 12`). */
export function parse7zaPercent(chunk: string): number | null {
  const matches = [...chunk.matchAll(/(\d{1,3})\s*%/g)]
  if (matches.length === 0) return null
  const last = matches[matches.length - 1]![1]!
  const n = Number.parseInt(last, 10)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, n))
}

/**
 * Run `7za a -tzip` streaming to disk. Progress is 0–100 from 7za; Cancel kills the process.
 */
function run7zaAddZip(opts: {
  zipPath: string
  cwd: string
  /** Paths relative to `cwd` (basenames / relative names). */
  items: string[]
  progress: OpReporter
  /** Map 7za 0–100 into this overall progress window. */
  progressBase?: number
  progressSpan?: number
}): Promise<void> {
  const { zipPath, cwd, items, progress } = opts
  const base = opts.progressBase ?? 0
  const span = opts.progressSpan ?? 100
  if (items.length === 0) return Promise.resolve()

  const bin = resolve7zaPath()
  // List file avoids Windows command-line length limits + preserves Unicode names.
  const listPath = path.join(
    os.tmpdir(),
    `mfe-zip-list-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  )

  return (async () => {
    await fsp.writeFile(listPath, items.map((i) => i.replace(/\r?\n/g, ' ')).join('\n'), 'utf8')
    progress.throwIfCancelled()

    await new Promise<void>((resolve, reject) => {
      const args = [
        'a',
        '-tzip',
        '-mx=5',
        '-y',
        '-bsp1',
        '-bse1',
        '-sccUTF-8',
        zipPath,
        `@${listPath}`
      ]
      const child = spawn(bin, args, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stderr = ''
      let settled = false
      const cancelPoll = setInterval(() => {
        if (!progress.isCancelled()) return
        try {
          if (process.platform === 'win32' && child.pid) {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore'
            })
          } else {
            child.kill('SIGKILL')
          }
        } catch {
          /* ignore */
        }
      }, 200)

      const finish = (err: Error | null): void => {
        if (settled) return
        settled = true
        clearInterval(cancelPoll)
        void fsp.unlink(listPath).catch(() => {})
        if (err) reject(err)
        else resolve()
      }

      const onChunk = (buf: Buffer): void => {
        const text = buf.toString('utf8')
        stderr += text
        if (stderr.length > 32_000) stderr = stderr.slice(-16_000)
        const pct = parse7zaPercent(text)
        if (pct != null) {
          const mapped = Math.min(100, Math.round(base + (pct / 100) * span))
          try {
            progress.setDone(mapped, path.basename(zipPath))
          } catch (e) {
            try {
              child.kill()
            } catch {
              /* ignore */
            }
            finish(e instanceof Error ? e : cancelledError())
          }
        } else {
          try {
            progress.pulse(path.basename(zipPath))
          } catch (e) {
            try {
              child.kill()
            } catch {
              /* ignore */
            }
            finish(e instanceof Error ? e : cancelledError())
          }
        }
      }

      child.stdout?.on('data', onChunk)
      child.stderr?.on('data', onChunk)
      child.on('error', (e) => {
        finish(
          new AppError(
            'io',
            `Could not start 7za: ${e.message}`,
            'ZIP compression requires the bundled 7-Zip helper.'
          )
        )
      })
      child.on('close', (code, signal) => {
        if (progress.isCancelled() || signal === 'SIGTERM' || signal === 'SIGKILL') {
          finish(cancelledError())
          return
        }
        // 0 = OK, 1 = warning (non-fatal) — both acceptable for compress.
        if (code === 0 || code === 1) {
          try {
            progress.setDone(Math.min(100, base + span), path.basename(zipPath))
          } catch {
            /* ignore */
          }
          finish(null)
          return
        }
        const detail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ')
        finish(
          new AppError('io', `Compress failed${detail ? `: ${detail}` : ''}`.slice(0, 240))
        )
      })
    })
  })()
}

/**
 * Create a `.zip` next to the selection (Explorer “Compress to ZIP file”).
 * - One file → `Name.zip` (last extension stripped)
 * - One folder → `FolderName.zip`
 * - Multiple → `{parentFolder}.zip`
 *
 * Uses bundled 7za to stream to disk (not JSZip in-memory generate) so large
 * folders stay cancelable and progress reflects real compression work.
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

  const progress = beginOp('zip', 100, 'Compressing…')
  progress.pulse(path.basename(zipPath))

  try {
    const sameParent = commonParentDir(sourcesToPack) != null
    if (sameParent) {
      await run7zaAddZip({
        zipPath,
        cwd: path.dirname(sourcesToPack[0]!),
        items: sourcesToPack.map((p) => path.basename(p)),
        progress
      })
    } else {
      // Different parents: append each root (basename) from its own folder.
      const n = sourcesToPack.length
      for (let i = 0; i < n; i++) {
        progress.throwIfCancelled()
        const src = sourcesToPack[i]!
        const span = Math.floor(100 / n)
        const base = i * span
        const lastSpan = i === n - 1 ? 100 - base : span
        await run7zaAddZip({
          zipPath,
          cwd: path.dirname(src),
          items: [path.basename(src)],
          progress,
          progressBase: base,
          progressSpan: lastSpan
        })
      }
    }
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
