import type { SlideshowAccumulatedCrop } from '@shared/slideshow/crop'
import { cropExtractRect } from '@shared/slideshow/crop'
import { api, call } from './ipc'

export type CropOriginalBitmap = {
  path: string
  img: HTMLImageElement
  width: number
  height: number
}

/** Draw accumulated crop preview (object-fit: contain on the cropped region). */
export function drawSlideshowCropPreview(
  canvas: HTMLCanvasElement,
  bitmap: CropOriginalBitmap,
  acc: SlideshowAccumulatedCrop
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const cw = Math.max(1, Math.round(rect.width * dpr))
  const ch = Math.max(1, Math.round(rect.height * dpr))
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw
    canvas.height = ch
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)

  const src = cropExtractRect(bitmap.width, bitmap.height, acc)
  const scale = Math.min(cw / src.width, ch / src.height)
  const dw = src.width * scale
  const dh = src.height * scale
  const dx = (cw - dw) / 2
  const dy = (ch - dh) / 2

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap.img, src.left, src.top, src.width, src.height, dx, dy, dw, dh)
}

export async function loadCropOriginalBitmap(imagePath: string): Promise<CropOriginalBitmap> {
  const res = await call(api.fs.readImageForEdit({ path: imagePath, ads: null }))
  const url = `data:${res.mime};base64,${res.dataBase64}`
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  if (typeof img.decode === 'function') await img.decode()
  else {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to load image'))
    })
  }
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error('Could not read image dimensions')
  }
  return {
    path: imagePath,
    img,
    width: img.naturalWidth,
    height: img.naturalHeight
  }
}
