import { api } from './ipc'
import {
  CAPTION_ADS_NAME,
  captionAccentFromStream,
  normalizeCaptionAdsStream,
  parseCaptionAds,
  pickRandomCaption,
  type CaptionEntry
} from '@shared/slideshow/captionAds'

const W = 1080
const H = 1440
const PAD = 56
const WHITE = '#f4f4f4'
const BORDER_PX = 4
/** Black inset between the colored frame and the photo. */
const FRAME_GAP = 20

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const lines: string[] = []
  let cur = words[0]!
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!
    const trial = `${cur} ${w}`
    if (ctx.measureText(trial).width <= maxWidth) {
      cur = trial
    } else {
      lines.push(cur)
      cur = w
      if (lines.length >= maxLines - 1) {
        const rest = [w, ...words.slice(i + 1)].join(' ')
        let clipped = rest
        while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
          clipped = clipped.slice(0, -1)
        }
        lines.push(ctx.measureText(rest).width <= maxWidth ? rest : `${clipped}…`)
        return lines
      }
    }
  }
  lines.push(cur)
  return lines
}

function fitCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  family: string,
  weight: string
): number {
  let size = maxSize
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${family}`
    if (ctx.measureText(text).width <= maxWidth) return size
    size -= 2
  }
  ctx.font = `${weight} ${minSize}px ${family}`
  return minSize
}

type PhotoSource = CanvasImageSource & {
  width?: number
  height?: number
  naturalWidth?: number
  naturalHeight?: number
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: PhotoSource,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  if (!(w > 0) || !(h > 0)) return
  const iw = img.naturalWidth ?? img.width ?? 0
  const ih = img.naturalHeight ?? img.height ?? 0
  if (!(iw > 0) || !(ih > 0)) return
  const ir = iw / ih
  const br = w / h
  let sx = 0
  let sy = 0
  let sw = iw
  let sh = ih
  if (ir > br) {
    sw = ih * br
    sx = (iw - sw) / 2
  } else {
    sh = iw / br
    sy = (ih - sh) / 2
  }
  // Clamp — FP crop rects slightly outside the bitmap throw IndexSizeError.
  sx = Math.max(0, Math.min(sx, iw - 1))
  sy = Math.max(0, Math.min(sy, ih - 1))
  sw = Math.max(1, Math.min(sw, iw - sx))
  sh = Math.max(1, Math.min(sh, ih - sy))
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

function adsFromMediaUrl(url: string): string | null {
  try {
    const ads = new URL(url).searchParams.get('ads')
    const t = ads?.trim()
    return t ? t : null
  } catch {
    return null
  }
}

function blobFromBase64(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime || 'image/jpeg' })
}

/** Same-origin bitmap so canvas.toDataURL is not tainted by mfe-media. */
async function originCleanBitmap(
  filePath: string,
  photo: HTMLImageElement
): Promise<ImageBitmap | null> {
  if (photo.src) {
    try {
      const res = await fetch(photo.src)
      if (res.ok) return await createImageBitmap(await res.blob())
    } catch {
      /* CORS / protocol — fall through to IPC bytes */
    }
  }
  try {
    const ads = photo.src ? adsFromMediaUrl(photo.src) : null
    const res = await api.fs.readImageForEdit({ path: filePath, ads })
    if (!res.ok) return null
    return await createImageBitmap(blobFromBase64(res.value.dataBase64, res.value.mime))
  } catch {
    return null
  }
}

export async function decodeImageUrl(url: string): Promise<HTMLImageElement | null> {
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  try {
    if (typeof img.decode === 'function') await img.decode()
    else {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('load'))
      })
    }
  } catch {
    return null
  }
  if (!img.complete || img.naturalWidth <= 0) return null
  return img
}

/** Demotivational poster: photo in the frame; hashed color on border + titles. */
export function drawCaptionPoster(
  entry: CaptionEntry,
  photo: PhotoSource,
  accent: string
): string {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, W, H)

  const innerW = W - PAD * 2
  let y = PAD

  const caption = entry.caption
  if (caption) {
    ctx.fillStyle = accent
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.font = '500 34px "Segoe UI", Arial, sans-serif'
    const lines = wrapLines(ctx, caption, innerW, 3)
    for (const line of lines) {
      ctx.fillText(line, W / 2, y)
      y += 42
    }
    y += 18
  } else {
    y += 8
  }

  const bottomReserve = 320
  const boxX = PAD
  const boxY = y
  const boxW = innerW
  const boxH = Math.max(280, H - boxY - bottomReserve)

  const imgX = boxX + BORDER_PX + FRAME_GAP
  const imgY = boxY + BORDER_PX + FRAME_GAP
  const imgW = boxW - 2 * (BORDER_PX + FRAME_GAP)
  const imgH = boxH - 2 * (BORDER_PX + FRAME_GAP)

  ctx.save()
  ctx.beginPath()
  ctx.rect(imgX, imgY, imgW, imgH)
  ctx.clip()
  drawCover(ctx, photo, imgX, imgY, imgW, imgH)
  ctx.restore()

  ctx.strokeStyle = accent
  ctx.lineWidth = BORDER_PX
  ctx.strokeRect(
    boxX + BORDER_PX / 2,
    boxY + BORDER_PX / 2,
    boxW - BORDER_PX,
    boxH - BORDER_PX
  )

  let textY = boxY + boxH + 36
  const desc = entry.descriptor.toUpperCase()
  if (desc) {
    ctx.fillStyle = accent
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const family = '"Times New Roman", Times, Georgia, serif'
    const size = fitCentered(ctx, desc, innerW, 78, 28, family, '700')
    ctx.font = `700 ${size}px ${family}`
    // Modest tracking — not per-letter spaces stretched to full width.
    ctx.letterSpacing = `${Math.max(1, Math.round(size * 0.06))}px`
    ctx.fillText(desc, W / 2, textY)
    const textW = ctx.measureText(desc).width
    const underlineW = Math.min(innerW, textW + 28)
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo((W - underlineW) / 2, textY + size + 8)
    ctx.lineTo((W + underlineW) / 2, textY + size + 8)
    ctx.stroke()
    ctx.letterSpacing = '0px'
    textY += size + 28
  }

  if (entry.sentence) {
    ctx.fillStyle = WHITE
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.font = '400 28px "Segoe UI", Arial, sans-serif'
    const lines = wrapLines(ctx, entry.sentence, innerW, 6)
    for (const line of lines) {
      ctx.fillText(line, W / 2, textY)
      textY += 36
    }
  }

  try {
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

/**
 * If the file has a Caption ADS, composite a random poster around `photo`.
 * `photo` is the decoded original / tip edit.
 */
export async function tryCaptionPosterUrl(
  filePath: string,
  photo: HTMLImageElement
): Promise<string | null> {
  try {
    const res = await api.ads.readText({ path: filePath, name: CAPTION_ADS_NAME })
    if (!res.ok) return null
    const streamText = normalizeCaptionAdsStream(res.value.text)
    const entries = parseCaptionAds(streamText)
    const pick = pickRandomCaption(entries)
    if (!pick) return null
    const accent = captionAccentFromStream(streamText)
    const bmp = await originCleanBitmap(filePath, photo)
    if (!bmp) return null
    try {
      const url = drawCaptionPoster(pick, bmp, accent)
      return url || null
    } finally {
      bmp.close()
    }
  } catch {
    return null
  }
}
