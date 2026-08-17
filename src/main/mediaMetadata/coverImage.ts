/** Movie/TV covers are portrait (taller than wide). Stills and backdrops are landscape. */

export function isPortraitCover(width: number, height: number): boolean {
  return width > 0 && height > 0 && height > width
}

export async function imageSize(buf: Buffer): Promise<{ width: number; height: number }> {
  try {
    const sharp = (await import('sharp')).default
    const m = await sharp(buf, { failOn: 'none', limitInputPixels: 80 * 1024 * 1024 }).metadata()
    return { width: m.width ?? 0, height: m.height ?? 0 }
  } catch {
    return { width: 0, height: 0 }
  }
}

export async function isPortraitCoverBuffer(buf: Buffer): Promise<boolean> {
  const { width, height } = await imageSize(buf)
  return isPortraitCover(width, height)
}

/**
 * Walk image buffers and keep the first portrait cover.
 * If none are portrait, return the first usable image (better than empty).
 */
export async function firstPortraitCover(buffers: Array<Buffer | null | undefined>): Promise<Buffer | null> {
  return pickBestCover(buffers)
}

/** Largest portrait; if none, largest usable image. */
export async function pickBestCover(buffers: Array<Buffer | null | undefined>): Promise<Buffer | null> {
  const portraits: { buf: Buffer; area: number }[] = []
  const others: { buf: Buffer; area: number }[] = []
  for (const buf of buffers) {
    if (!buf || buf.length < 32) continue
    const { width, height } = await imageSize(buf)
    const area = Math.max(0, width) * Math.max(0, height)
    if (isPortraitCover(width, height)) portraits.push({ buf, area })
    else others.push({ buf, area })
  }
  const pool = portraits.length > 0 ? portraits : others
  pool.sort((a, b) => b.area - a.area)
  return pool[0]?.buf ?? null
}
