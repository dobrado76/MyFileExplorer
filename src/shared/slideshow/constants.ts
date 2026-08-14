export const SLIDESHOW_IMAGE_EXTS = new Set([
  'jpg',
  'jpeg',
  'jfif',
  'png',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'tga',
  'hdr'
])

export function isSlideshowImagePath(filePath: string): boolean {
  const base = filePath.replace(/^.*[/\\]/, '')
  const i = base.lastIndexOf('.')
  if (i < 0) return false
  return SLIDESHOW_IMAGE_EXTS.has(base.slice(i + 1).toLowerCase())
}

export const SLIDESHOW_DELAY_MS_MIN = 0
export const SLIDESHOW_DELAY_MS_DEFAULT = 2000

/** Cap for persisted / in-memory slideshow image list (matches walk cap). */
export const SLIDESHOW_IMAGE_LIST_CAP = 100_000
