import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { AppError } from '@shared/result'
import { imageExt, isEditableImagePath, sharpFormatForExt } from '@shared/imageEdit'
import { pathKey } from '../security/paths'
import { requireAbsolute } from './list'
import { muteWatchers } from './watch'

type OriginalIndex = Record<string, { file: string; savedAt: number }>

function originalsDir(): string {
  return path.join(app.getPath('userData'), 'image-originals')
}

function indexPath(): string {
  return path.join(originalsDir(), 'index.json')
}

async function readIndex(): Promise<OriginalIndex> {
  try {
    const raw = await fsp.readFile(indexPath(), 'utf8')
    const parsed = JSON.parse(raw) as OriginalIndex
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeIndex(index: OriginalIndex): Promise<void> {
  await fsp.mkdir(originalsDir(), { recursive: true })
  const tmp = indexPath() + '.tmp'
  await fsp.writeFile(tmp, JSON.stringify(index, null, 2), 'utf8')
  await fsp.rename(tmp, indexPath())
}

function backupFileName(absPath: string): string {
  const hash = crypto.createHash('sha1').update(pathKey(absPath)).digest('hex')
  const ext = imageExt(absPath) || 'bin'
  return `${hash}.${ext}`
}

function stripDataUrl(dataBase64: string): { mime: string | null; bytes: Buffer } {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataBase64)
  if (m) {
    return { mime: m[1] ?? null, bytes: Buffer.from(m[2]!, 'base64') }
  }
  return { mime: null, bytes: Buffer.from(dataBase64, 'base64') }
}

async function encodeAndWrite(destFile: string, dataBase64: string): Promise<void> {
  const { bytes } = stripDataUrl(dataBase64)
  if (bytes.length === 0) throw new AppError('validation', 'Empty image data')

  const ext = imageExt(destFile)
  const format = sharpFormatForExt(ext)
  if (!format) {
    throw new AppError('validation', `Unsupported image format: .${ext || '?'}`)
  }

  const { default: sharp } = await import('sharp')
  const tmp = destFile + '.mfe-edit.tmp'
  try {
    let pipeline = sharp(bytes, { failOn: 'truncated', limitInputPixels: 512 * 1024 * 1024 })
    if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: 92, mozjpeg: true })
    else if (format === 'png') pipeline = pipeline.png({ compressionLevel: 8 })
    else if (format === 'webp') pipeline = pipeline.webp({ quality: 90 })
    else if (format === 'tiff') pipeline = pipeline.tiff()
    else if (format === 'gif') pipeline = pipeline.gif()
    else if (format === 'avif') pipeline = pipeline.avif({ quality: 80 })
    else pipeline = pipeline.toFormat(format)

    await fsp.mkdir(path.dirname(destFile), { recursive: true })
    await pipeline.toFile(tmp)
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

/** True when a pristine backup exists under userData for this path. */
export async function hasImageOriginal(rawPath: string): Promise<{ hasOriginal: boolean }> {
  const file = requireAbsolute(rawPath)
  const index = await readIndex()
  const entry = index[pathKey(file)]
  if (!entry) return { hasOriginal: false }
  try {
    await fsp.access(path.join(originalsDir(), entry.file))
    return { hasOriginal: true }
  } catch {
    return { hasOriginal: false }
  }
}

/**
 * Write edited bytes to an arbitrary path. Does **not** create a revert backup
 * (used by Save As).
 */
export async function writeEditedImageToPath(
  destPath: string,
  dataBase64: string
): Promise<{ path: string }> {
  const file = requireAbsolute(destPath)
  if (!isEditableImagePath(file)) {
    throw new AppError(
      'validation',
      'Choose a supported image extension (png, jpg, webp, gif, tiff, …)'
    )
  }
  muteWatchers(1500)
  await encodeAndWrite(file, dataBase64)
  return { path: file }
}

/**
 * First edit: copy live file → userData backup (never overwrite an existing backup).
 * Then write edited bytes to the live path (Sharp re-encode to match extension).
 */
export async function saveEditedImage(
  rawPath: string,
  dataBase64: string
): Promise<{ path: string; preservedOriginal: boolean }> {
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

  await fsp.mkdir(originalsDir(), { recursive: true })
  const index = await readIndex()
  const key = pathKey(file)
  let preservedOriginal = false

  muteWatchers(1500)

  if (!index[key]) {
    const backupName = backupFileName(file)
    const backupAbs = path.join(originalsDir(), backupName)
    await fsp.copyFile(file, backupAbs)
    index[key] = { file: backupName, savedAt: Date.now() }
    await writeIndex(index)
    preservedOriginal = true
  } else {
    try {
      await fsp.access(path.join(originalsDir(), index[key]!.file))
    } catch {
      const backupName = backupFileName(file)
      const backupAbs = path.join(originalsDir(), backupName)
      await fsp.copyFile(file, backupAbs)
      index[key] = { file: backupName, savedAt: Date.now() }
      await writeIndex(index)
      preservedOriginal = true
    }
  }

  await encodeAndWrite(file, dataBase64)
  return { path: file, preservedOriginal }
}

/** Restore live file from the userData pristine backup, then drop the backup. */
export async function revertImageOriginal(
  rawPath: string
): Promise<{ path: string; reverted: boolean }> {
  const file = requireAbsolute(rawPath)
  const index = await readIndex()
  const key = pathKey(file)
  const entry = index[key]
  if (!entry) {
    throw new AppError('not-found', 'No original backup for this image')
  }
  const backupAbs = path.join(originalsDir(), entry.file)
  try {
    await fsp.access(backupAbs)
  } catch {
    delete index[key]
    await writeIndex(index)
    throw new AppError('not-found', 'Original backup file is missing')
  }

  muteWatchers(1500)
  const tmp = file + '.mfe-revert.tmp'
  try {
    await fsp.copyFile(backupAbs, tmp)
    await fsp.rename(tmp, file)
    await fsp.unlink(backupAbs)
  } catch (e) {
    try {
      await fsp.unlink(tmp)
    } catch {
      // ignore
    }
    throw e instanceof AppError
      ? e
      : new AppError('io', e instanceof Error ? e.message : 'Failed to revert image')
  }

  delete index[key]
  await writeIndex(index)
  return { path: file, reverted: true }
}

/** Read image bytes for the in-app editor (avoids renderer fetch of mfe-media). */
export async function readImageForEdit(
  rawPath: string
): Promise<{ dataBase64: string; mime: string }> {
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
  if (st.size > 96 * 1024 * 1024) {
    throw new AppError('validation', 'Image is too large to edit in-app')
  }

  const buf = await fsp.readFile(file)
  const ext = imageExt(file)
  const mime =
    ext === 'jpg' || ext === 'jpeg' || ext === 'bmp'
      ? 'image/jpeg'
      : ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'gif'
            ? 'image/gif'
            : ext === 'avif'
              ? 'image/avif'
              : ext === 'tif' || ext === 'tiff'
                ? 'image/tiff'
                : 'application/octet-stream'

  return { dataBase64: buf.toString('base64'), mime }
}
