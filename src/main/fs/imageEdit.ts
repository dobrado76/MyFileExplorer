import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { AppError } from '@shared/result'
import {
  IMAGE_VER_COUNT_STREAM,
  IMAGE_VER_MAX,
  imageExt,
  isEditableImagePath,
  isImageVersionStreamName,
  parseVerCount,
  renumberAfterDrop,
  renumberAfterShiftOldest,
  sharpFormatForExt,
  verStreamName
} from '@shared/imageEdit'
import type { SlideshowAccumulatedCrop } from '@shared/slideshow/crop'
import { cropExtractRect } from '@shared/slideshow/crop'
import { pathKey } from '../security/paths'
import {
  buildStreamPath,
  copyStreams,
  deleteStream,
  listStreams,
  readStreamBytes,
  readStreamText,
  streamExists,
  writeStreamBytes
} from './adsWin32'
import { pathIsNtfs } from './drives'
import { requireAbsolute } from './list'
import { muteWatchers } from './watch'
import { preserveMetadataFromSource } from './imageMetadata'

export type ImageEditState = {
  versionCount: number
  tipVer: number
  hasVersions: boolean
}

type OriginalIndex = Record<string, { file: string; savedAt: number }>

function originalsDir(): string {
  return path.join(app.getPath('userData'), 'image-originals')
}

function indexPath(): string {
  return path.join(originalsDir(), 'index.json')
}

function stripDataUrl(dataBase64: string): { mime: string | null; bytes: Buffer } {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataBase64)
  if (m) {
    return { mime: m[1] ?? null, bytes: Buffer.from(m[2]!, 'base64') }
  }
  return { mime: null, bytes: Buffer.from(dataBase64, 'base64') }
}

function mimeForImagePath(file: string): string {
  const ext = imageExt(file)
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'bmp') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'avif') return 'image/avif'
  if (ext === 'tif' || ext === 'tiff') return 'image/tiff'
  return 'application/octet-stream'
}

async function encodeEditedBuffer(
  destFile: string,
  dataBase64: string,
  metadataSourceFile?: string
): Promise<Buffer> {
  const { bytes } = stripDataUrl(dataBase64)
  if (bytes.length === 0) throw new AppError('validation', 'Empty image data')
  return encodeRawImageBuffer(destFile, bytes, metadataSourceFile)
}

async function encodeRawImageBuffer(
  destFile: string,
  bytes: Buffer,
  metadataSourceFile?: string
): Promise<Buffer> {
  if (bytes.length === 0) throw new AppError('validation', 'Empty image data')

  const ext = imageExt(destFile)
  const format = sharpFormatForExt(ext)
  if (!format) {
    throw new AppError('validation', `Unsupported image format: .${ext || '?'}`)
  }

  const { default: sharp } = await import('sharp')
  try {
    let pipeline = sharp(bytes, { failOn: 'truncated', limitInputPixels: 512 * 1024 * 1024 })
    if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: 92, mozjpeg: true })
    else if (format === 'png') pipeline = pipeline.png({ compressionLevel: 8 })
    else if (format === 'webp') pipeline = pipeline.webp({ quality: 90 })
    else if (format === 'tiff') pipeline = pipeline.tiff()
    else if (format === 'gif') pipeline = pipeline.gif()
    else if (format === 'avif') pipeline = pipeline.avif({ quality: 80 })
    else pipeline = pipeline.toFormat(format)

    let encoded = await pipeline.toBuffer()
    if (metadataSourceFile) {
      try {
        // `$DATA` holds the pristine original (and its metadata) when version ADS exist.
        const sourceBytes = await fsp.readFile(metadataSourceFile)
        encoded = await preserveMetadataFromSource(
          encoded,
          destFile,
          sourceBytes,
          imageExt(metadataSourceFile)
        )
      } catch {
        /* metadata is best-effort — never block save */
      }
    }
    return encoded
  } catch (e) {
    throw e instanceof AppError
      ? e
      : new AppError('io', e instanceof Error ? e.message : 'Failed to encode edited image')
  }
}

async function writeEncodedImageBytes(
  file: string,
  encoded: Buffer
): Promise<{ path: string; preservedOriginal: boolean; versionCount: number }> {
  const useAds = pathSupportsImageVersions(file)
  muteWatchers(2000)

  if (!useAds) {
    const tmp = file + '.mfe-edit.tmp'
    try {
      await fsp.writeFile(tmp, encoded)
      await fsp.rename(tmp, file)
    } catch (e) {
      try {
        await fsp.unlink(tmp)
      } catch {
        /* ignore */
      }
      throw e instanceof AppError
        ? e
        : new AppError('io', e instanceof Error ? e.message : 'Failed to save edited image')
    }
    return { path: file, preservedOriginal: false, versionCount: 0 }
  }

  let count = await readVerCount(file)
  const preservedOriginal = count === 0

  try {
    if (count >= IMAGE_VER_MAX) {
      await shiftVersionsDown(file, count)
      count = IMAGE_VER_MAX - 1
    }
    const next = count + 1
    await writeStreamBytes(file, verStreamName(next), encoded)
    await writeVerCount(file, next)
    return { path: file, preservedOriginal, versionCount: next }
  } catch {
    const tmp = file + '.mfe-edit.tmp'
    try {
      await fsp.writeFile(tmp, encoded)
      await fsp.rename(tmp, file)
      return { path: file, preservedOriginal: false, versionCount: 0 }
    } catch (e2) {
      try {
        await fsp.unlink(tmp)
      } catch {
        /* ignore */
      }
      throw e2 instanceof AppError
        ? e2
        : new AppError('io', e2 instanceof Error ? e2.message : 'Failed to save edited image')
    }
  }
}

async function writeEncodedFile(
  destFile: string,
  dataBase64: string,
  metadataSourceFile?: string
): Promise<void> {
  const buf = await encodeEditedBuffer(destFile, dataBase64, metadataSourceFile)
  const tmp = destFile + '.mfe-edit.tmp'
  try {
    await fsp.mkdir(path.dirname(destFile), { recursive: true })
    await fsp.writeFile(tmp, buf)
    await fsp.rename(tmp, destFile)
  } catch (e) {
    try {
      await fsp.unlink(tmp)
    } catch {
      // ignore
    }
    throw e instanceof AppError
      ? e
      : new AppError('io', e instanceof Error ? e.message : 'Failed to save edited image')
  }
}

/** True when this path can keep `VER_*` ADS (win32 + NTFS). */
export function pathSupportsImageVersions(absPath: string): boolean {
  return pathIsNtfs(absPath)
}

/** Tip edit bytes when `VER_COUNT ≥ 1`, else null. */
export async function readImageTipBytes(rawPath: string): Promise<Buffer | null> {
  const file = requireAbsolute(rawPath)
  const count = await readVerCount(file)
  if (count < 1) return null
  return readStreamBytes(file, verStreamName(count))
}

/**
 * When copying/moving a versioned NTFS image onto a volume without ADS
 * (FAT/exFAT/…), return tip bytes to write as the destination **file body**
 * (commit-like — keep the latest edit, drop pristine original + history).
 * Otherwise null → use a normal file copy (NTFS→NTFS keeps streams).
 */
export async function tipBytesForNonAdsDest(
  sourcePath: string,
  destPath: string
): Promise<Buffer | null> {
  if (!isEditableImagePath(sourcePath)) return null
  if (pathSupportsImageVersions(destPath)) return null
  return readImageTipBytes(sourcePath)
}

/** Read VER_COUNT from ADS; 0 when missing/invalid. */
export async function readVerCount(file: string): Promise<number> {
  if (process.platform !== 'win32') return 0
  try {
    if (!streamExists(file, IMAGE_VER_COUNT_STREAM)) return 0
    const text = await readStreamText(file, IMAGE_VER_COUNT_STREAM)
    return parseVerCount(text)
  } catch {
    return 0
  }
}

export async function getImageEditState(rawPath: string): Promise<ImageEditState> {
  const file = requireAbsolute(rawPath)
  const versionCount = await readVerCount(file)
  return {
    versionCount,
    tipVer: versionCount,
    hasVersions: versionCount >= 1
  }
}

/**
 * Resolve which bytes to show/edit.
 * - `ads === undefined` → tip (`VER_{count}`) or `$DATA` when count=0
 * - `ads === null` → `$DATA` (original)
 * - `ads === 'VER_k'` → that version stream
 */
export async function resolveImageAdsStream(
  rawPath: string,
  ads?: string | null
): Promise<{
  file: string
  /** Absolute path to open (file or `file:VER_n:$DATA`). */
  openPath: string
  /** Stream name, or null for `$DATA`. */
  ads: string | null
  versionCount: number
  /** Cache-bust token including version tip size when applicable. */
  cacheKey: string
}> {
  const file = requireAbsolute(rawPath)
  let st
  try {
    st = await fsp.stat(file)
  } catch {
    throw new AppError('not-found', 'File not found')
  }
  if (!st.isFile()) throw new AppError('validation', 'Not a file')

  const versionCount = await readVerCount(file)
  let resolved: string | null
  if (ads === null) {
    resolved = null
  } else if (typeof ads === 'string') {
    const name = ads.trim()
    if (!name || name.toUpperCase() === '$DATA') resolved = null
    else resolved = name
  } else if (versionCount >= 1) {
    resolved = verStreamName(versionCount)
  } else {
    resolved = null
  }

  let openPath = file
  let streamSize = st.size
  if (resolved) {
    openPath = buildStreamPath(file, resolved)
    try {
      const sst = await fsp.stat(openPath)
      streamSize = sst.size
    } catch {
      // fall back to default-stream size for cache key
    }
  }

  return {
    file,
    openPath,
    ads: resolved,
    versionCount,
    cacheKey: `${st.mtimeMs}-${st.size}-v${versionCount}-${resolved ?? 'data'}-${streamSize}`
  }
}

async function deleteAllVersionStreams(file: string): Promise<void> {
  const count = await readVerCount(file)
  for (let i = 1; i <= Math.max(count, IMAGE_VER_MAX); i++) {
    const name = verStreamName(i)
    if (streamExists(file, name)) {
      try {
        deleteStream(file, name)
      } catch {
        /* continue */
      }
    }
  }
  // Also sweep any orphan VER_* listed by BackupRead
  try {
    for (const s of listStreams(file)) {
      if (isImageVersionStreamName(s.name) && streamExists(file, s.name)) {
        try {
          deleteStream(file, s.name)
        } catch {
          /* continue */
        }
      }
    }
  } catch {
    /* soft */
  }
  if (streamExists(file, IMAGE_VER_COUNT_STREAM)) {
    try {
      deleteStream(file, IMAGE_VER_COUNT_STREAM)
    } catch {
      /* soft */
    }
  }
}

async function writeVerCount(file: string, count: number): Promise<void> {
  if (count <= 0) {
    if (streamExists(file, IMAGE_VER_COUNT_STREAM)) deleteStream(file, IMAGE_VER_COUNT_STREAM)
    return
  }
  await writeStreamBytes(file, IMAGE_VER_COUNT_STREAM, Buffer.from(String(count), 'utf8'))
}

async function shiftVersionsDown(file: string, count: number): Promise<void> {
  const { map, newCount } = renumberAfterShiftOldest(count)
  // Read all survivors first (avoid clobber while shifting)
  const buffers = new Map<number, Buffer>()
  for (const [oldVer, newVer] of map) {
    const buf = await readStreamBytes(file, verStreamName(oldVer))
    if (buf) buffers.set(newVer, buf)
  }
  // Delete old VER_* then rewrite densely
  for (let i = 1; i <= count; i++) {
    const name = verStreamName(i)
    if (streamExists(file, name)) {
      try {
        deleteStream(file, name)
      } catch {
        /* continue */
      }
    }
  }
  for (const [newVer, buf] of buffers) {
    await writeStreamBytes(file, verStreamName(newVer), buf)
  }
  await writeVerCount(file, newCount)
}

/**
 * Write edited bytes to an arbitrary path. Does **not** create version history
 * (used by Save As).
 */
export async function writeEditedImageToPath(
  destPath: string,
  dataBase64: string,
  metadataSourcePath?: string
): Promise<{ path: string }> {
  const file = requireAbsolute(destPath)
  if (!isEditableImagePath(file)) {
    throw new AppError(
      'validation',
      'Choose a supported image extension (png, jpg, webp, gif, tiff, …)'
    )
  }
  muteWatchers(1500)
  const metaSource = metadataSourcePath ? requireAbsolute(metadataSourcePath) : undefined
  await writeEncodedFile(file, dataBase64, metaSource)
  return { path: file }
}

/**
 * Save in-app edit.
 * - **NTFS:** write tip ADS (`VER_n`); leave the default stream as the pristine original.
 * - **Non-NTFS** (or ADS write failure): overwrite the file body in place — no version
 *   streams exist there, and no warning (normal destructive save).
 */
export async function saveEditedImage(
  rawPath: string,
  dataBase64: string
): Promise<{ path: string; preservedOriginal: boolean; versionCount: number }> {
  const file = requireAbsolute(rawPath)
  if (!isEditableImagePath(file)) {
    throw new AppError('validation', 'This image type cannot be edited in-app')
  }

  let st
  try {
    st = await fsp.stat(file)
  } catch {
    throw new AppError('not-found', 'File not found')
  }
  if (!st.isFile()) throw new AppError('validation', 'Not a file')

  const encoded = await encodeEditedBuffer(file, dataBase64, file)
  return writeEncodedImageBytes(file, encoded)
}

/** Delete all `VER_*` / `VER_COUNT` — leave `$DATA` and other ADS untouched. */
export async function revertImageOriginal(
  rawPath: string
): Promise<{ path: string; reverted: boolean }> {
  const file = requireAbsolute(rawPath)
  const count = await readVerCount(file)
  if (count < 1) {
    throw new AppError('not-found', 'No version history for this image')
  }
  muteWatchers(1500)
  try {
    await deleteAllVersionStreams(file)
  } catch (e) {
    throw e instanceof AppError
      ? e
      : new AppError('io', e instanceof Error ? e.message : 'Failed to revert image')
  }
  return { path: file, reverted: true }
}

/**
 * Collapse tip into `$DATA`, drop version streams, preserve every other ADS.
 * Uses sibling `{basename}._tmp` then replace.
 */
export async function commitImageVersion(
  rawPath: string
): Promise<{ path: string; committed: boolean }> {
  const file = requireAbsolute(rawPath)
  const count = await readVerCount(file)
  if (count < 1) {
    throw new AppError('not-found', 'No version history for this image')
  }
  const tipName = verStreamName(count)
  const tip = await readStreamBytes(file, tipName)
  if (!tip) {
    throw new AppError('not-found', `Missing tip stream ${tipName}`)
  }

  const temp = `${file}._tmp`
  muteWatchers(2500)

  try {
    // Do not delete `src` until temp is fully written (default + preserved ADS).
    await fsp.writeFile(temp, tip)
    await copyStreams(file, temp, undefined, isImageVersionStreamName)

    await fsp.unlink(file)
    await fsp.rename(temp, file)
    return { path: file, committed: true }
  } catch (e) {
    try {
      await fsp.unlink(temp)
    } catch {
      // ignore orphan cleanup failure
    }
    throw e instanceof AppError
      ? e
      : new AppError('io', e instanceof Error ? e.message : 'Failed to commit image version')
  }
}

/** Drop one version stream and renumber survivors densely; update VER_COUNT. */
export async function dropImageVersion(
  rawPath: string,
  ver: number
): Promise<{ path: string; versionCount: number }> {
  const file = requireAbsolute(rawPath)
  const count = await readVerCount(file)
  if (count < 1) {
    throw new AppError('not-found', 'No version history for this image')
  }
  if (!Number.isInteger(ver) || ver < 1 || ver > count) {
    throw new AppError('validation', `Version must be between 1 and ${count}`)
  }

  const { newCount, map } = renumberAfterDrop(count, ver)
  muteWatchers(2000)

  try {
    const buffers = new Map<number, Buffer>()
    for (const [oldVer, newVer] of map) {
      const buf = await readStreamBytes(file, verStreamName(oldVer))
      if (buf) buffers.set(newVer, buf)
    }
    for (let i = 1; i <= count; i++) {
      const name = verStreamName(i)
      if (streamExists(file, name)) {
        try {
          deleteStream(file, name)
        } catch {
          /* continue */
        }
      }
    }
    for (const [newVer, buf] of buffers) {
      await writeStreamBytes(file, verStreamName(newVer), buf)
    }
    await writeVerCount(file, newCount)
    return { path: file, versionCount: newCount }
  } catch (e) {
    throw e instanceof AppError
      ? e
      : new AppError('io', e instanceof Error ? e.message : 'Failed to drop image version')
  }
}

/** @deprecated Prefer getImageEditState — kept for soft migration of callers. */
export async function hasImageOriginal(rawPath: string): Promise<{ hasOriginal: boolean }> {
  const state = await getImageEditState(rawPath)
  return { hasOriginal: state.hasVersions }
}

/** Read tip (or override) bytes for the in-app editor. */
export async function readImageForEdit(
  rawPath: string,
  ads?: string | null
): Promise<{ dataBase64: string; mime: string }> {
  const resolved = await resolveImageAdsStream(rawPath, ads)
  if (!isEditableImagePath(resolved.file)) {
    throw new AppError('validation', 'This image type cannot be edited in-app')
  }

  let st
  try {
    st = await fsp.stat(resolved.openPath)
  } catch {
    throw new AppError('not-found', 'File not found')
  }
  if (st.size > 96 * 1024 * 1024) {
    throw new AppError('validation', 'Image is too large to edit in-app')
  }

  const buf = await fsp.readFile(resolved.openPath)
  return { dataBase64: buf.toString('base64'), mime: mimeForImagePath(resolved.file) }
}

/**
 * Slideshow numpad crop — extract from pristine `$DATA` once, encode once, save as tip ADS.
 */
export async function cropSlideshowImageFromOriginal(
  rawPath: string,
  crop: SlideshowAccumulatedCrop
): Promise<{ path: string; preservedOriginal: boolean; versionCount: number }> {
  const file = requireAbsolute(rawPath)
  if (!isEditableImagePath(file)) {
    throw new AppError('validation', 'This image type cannot be edited in-app')
  }

  let st
  try {
    st = await fsp.stat(file)
  } catch {
    throw new AppError('not-found', 'File not found')
  }
  if (!st.isFile()) throw new AppError('validation', 'Not a file')

  const resolved = await resolveImageAdsStream(rawPath, null)
  const buf = await fsp.readFile(resolved.openPath)
  const { default: sharp } = await import('sharp')
  const meta = await sharp(buf).metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  if (w < 1 || h < 1) {
    throw new AppError('validation', 'Could not read image dimensions')
  }

  let rect
  try {
    rect = cropExtractRect(w, h, crop)
  } catch (e) {
    throw new AppError('validation', e instanceof Error ? e.message : 'Invalid crop')
  }

  let extracted: Buffer
  try {
    extracted = await sharp(buf).extract(rect).toBuffer()
  } catch (e) {
    throw new AppError(
      'io',
      e instanceof Error ? e.message : 'Failed to crop image'
    )
  }

  const encoded = await encodeRawImageBuffer(file, extracted, file)
  return writeEncodedImageBytes(file, encoded)
}

/**
 * One-shot AppData `image-originals/` → on-file ADS migration.
 * Restores backup to `$DATA`, writes previous live bytes to `VER_1`.
 */
export async function migrateImageOriginalsToAds(): Promise<{
  migrated: number
  skipped: number
  failed: number
}> {
  let migrated = 0
  let skipped = 0
  let failed = 0

  if (process.platform !== 'win32') {
    return { migrated, skipped, failed }
  }

  let index: OriginalIndex
  try {
    const raw = await fsp.readFile(indexPath(), 'utf8')
    const parsed = JSON.parse(raw) as OriginalIndex
    index = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return { migrated, skipped, failed }
  }

  const keys = Object.keys(index)
  if (keys.length === 0) return { migrated, skipped, failed }

  let changed = false
  for (const key of keys) {
    const entry = index[key]
    if (!entry) continue
    // Index is keyed by pathKey; recover path from… we only stored hash filenames.
    // Older index used pathKey(abs) → we cannot recover abs from key alone.
    // Scan is by matching files that still exist: we need the absolute path.
    // Historical index: Record<pathKey, {file,savedAt}> — pathKey is lowercased abs.
    // Reconstruct: pathKey is typically the normalized absolute path lowercased.
  }

  // Re-read with knowledge that keys ARE pathKey(absPath). pathKey lowercases;
  // on Windows we can use the key as a path candidate if it looks absolute.
  for (const key of [...keys]) {
    const entry = index[key]!
    const backupAbs = path.join(originalsDir(), entry.file)

    // pathKey stores a stable key — recover candidate path from key when it
    // looks like an absolute Windows path (D:\… or \\server\…).
    const candidate = key.includes(':') || key.startsWith('\\\\') ? key : null
    if (!candidate) {
      skipped += 1
      continue
    }

    let target: string
    try {
      target = requireAbsolute(candidate)
    } catch {
      skipped += 1
      continue
    }

    try {
      await fsp.access(target)
      await fsp.access(backupAbs)
    } catch {
      // Target or backup missing — drop stale index entry
      delete index[key]
      changed = true
      skipped += 1
      continue
    }

    try {
      const existing = await readVerCount(target)
      if (existing >= 1) {
        // Already migrated / has versions — drop AppData entry
        try {
          await fsp.unlink(backupAbs)
        } catch {
          /* ignore */
        }
        delete index[key]
        changed = true
        skipped += 1
        continue
      }

      const liveBytes = await fsp.readFile(target)
      const originalBytes = await fsp.readFile(backupAbs)

      muteWatchers(2000)
      // Restore original to $DATA, edit → VER_1
      const tmp = target + '.mfe-migrate.tmp'
      await fsp.writeFile(tmp, originalBytes)
      await fsp.rename(tmp, target)
      await writeStreamBytes(target, verStreamName(1), liveBytes)
      await writeVerCount(target, 1)

      try {
        await fsp.unlink(backupAbs)
      } catch {
        /* ignore */
      }
      delete index[key]
      changed = true
      migrated += 1
    } catch {
      failed += 1
      // leave index entry for retry
    }
  }

  if (changed) {
    try {
      await fsp.mkdir(originalsDir(), { recursive: true })
      const tmp = indexPath() + '.tmp'
      await fsp.writeFile(tmp, JSON.stringify(index, null, 2), 'utf8')
      await fsp.rename(tmp, indexPath())
    } catch {
      /* ignore index write failure */
    }
  }

  return { migrated, skipped, failed }
}

/** Exported for tests / callers that need the pathKey of a file. */
export function imageOriginalsPathKey(absPath: string): string {
  return pathKey(absPath)
}
