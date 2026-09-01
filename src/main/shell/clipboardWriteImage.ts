import { clipboard, nativeImage } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import { isSlideshowImagePath } from '@shared/slideshow/constants'
import { requireAbsolute, pathExists } from '../fs/list'
import { readImageTipBytes } from '../fs/imageEdit'
import { decodeTga } from '../preview/tga'
import { decodeHdr } from '../preview/hdr'

const MAX_FILE_BYTES = 512 * 1024 * 1024
const MAX_PIXELS = 512 * 1024 * 1024

/**
 * Put an image file on the OS clipboard as a bitmap (for paste into other apps).
 * Uses the latest in-app edit tip when present; otherwise the file body.
 */
export async function clipboardWriteImage(filePath: string): Promise<{ written: true }> {
  const file = requireAbsolute(filePath)
  if (!isSlideshowImagePath(file)) {
    throw new AppError('validation', 'Not an image file')
  }
  if (!(await pathExists(file))) {
    throw new AppError('not-found', 'File not found')
  }
  let st
  try {
    st = await fsp.stat(file)
  } catch {
    throw new AppError('not-found', 'File not found')
  }
  if (!st.isFile() || st.size <= 0) {
    throw new AppError('io', 'Empty or invalid image file')
  }
  if (st.size > MAX_FILE_BYTES) {
    throw new AppError('io', 'Image is too large to copy')
  }

  let input: Buffer
  try {
    const tip = await readImageTipBytes(file)
    input = tip && tip.length > 0 ? tip : await fsp.readFile(file)
  } catch (e) {
    throw new AppError('io', e instanceof Error ? e.message : 'Could not read image')
  }

  const png = await rasterToPng(file, input)
  const img = nativeImage.createFromBuffer(png)
  if (img.isEmpty()) {
    throw new AppError('io', 'Could not decode image for clipboard')
  }
  clipboard.writeImage(img)
  return { written: true }
}

async function rasterToPng(file: string, input: Buffer): Promise<Buffer> {
  const ext = path.extname(file).slice(1).toLowerCase()
  const { default: sharp } = await import('sharp')

  if (ext === 'tga' || ext === 'hdr') {
    const decoded = ext === 'tga' ? decodeTga(input) : decodeHdr(input)
    if (!decoded) {
      throw new AppError('io', ext === 'hdr' ? 'Unsupported .hdr format' : 'Could not decode TGA')
    }
    return sharp(decoded.rgba, {
      raw: { width: decoded.width, height: decoded.height, channels: 4 }
    })
      .png()
      .toBuffer()
  }

  try {
    return await sharp(input, {
      failOn: 'none',
      unlimited: true,
      limitInputPixels: MAX_PIXELS
    })
      .rotate()
      .toColorspace('srgb')
      .png()
      .toBuffer()
  } catch (e) {
    throw new AppError('io', e instanceof Error ? e.message : 'Could not decode image')
  }
}
