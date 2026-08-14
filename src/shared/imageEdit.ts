/** Raster formats we can edit in-place via Sharp re-encode. */
const EDITABLE_IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'jfif',
  'webp',
  'gif',
  'bmp',
  'avif',
  'tiff',
  'tif'
])

/** Max stacked in-app edit versions (VER_1…VER_N) on the file as ADS. */
export const IMAGE_VER_MAX = 4

/** ADS stream holding the decimal version count. */
export const IMAGE_VER_COUNT_STREAM = 'VER_COUNT'

const VER_NAME_RE = /^VER_(\d+)$/i

export function imageExt(filePath: string): string {
  const base = filePath.replace(/^.*[/\\]/, '')
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function isEditableImagePath(filePath: string): boolean {
  return EDITABLE_IMAGE_EXTS.has(imageExt(filePath))
}

/** Sharp output format id for a file extension (bmp → jpeg). */
export function sharpFormatForExt(
  ext: string
): 'png' | 'jpeg' | 'webp' | 'gif' | 'avif' | 'tiff' | null {
  switch (ext.toLowerCase()) {
    case 'png':
      return 'png'
    case 'jpg':
    case 'jpeg':
    case 'jfif':
    case 'bmp':
      return 'jpeg'
    case 'webp':
      return 'webp'
    case 'gif':
      return 'gif'
    case 'avif':
      return 'avif'
    case 'tiff':
    case 'tif':
      return 'tiff'
    default:
      return null
  }
}

/** ADS name for edit version `n` (1-based), e.g. `VER_2`. */
export function verStreamName(n: number): string {
  return `VER_${n}`
}

/** True for `VER_COUNT` or `VER_{digits}` (image edit version streams). */
export function isImageVersionStreamName(name: string): boolean {
  if (name.toUpperCase() === IMAGE_VER_COUNT_STREAM) return true
  return VER_NAME_RE.test(name)
}

/** Parse `VER_COUNT` text → clamped int, or 0 if invalid. */
export function parseVerCount(raw: string): number {
  const n = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(IMAGE_VER_MAX, Math.floor(n))
}

/**
 * After dropping `dropVer` (1-based), map old version index → new index.
 * Returns null if that version was dropped. Survivors renumber densely from 1.
 */
export function renumberAfterDrop(
  count: number,
  dropVer: number
): { newCount: number; map: Map<number, number> } {
  const map = new Map<number, number>()
  if (count < 1 || dropVer < 1 || dropVer > count) {
    for (let i = 1; i <= count; i++) map.set(i, i)
    return { newCount: count, map }
  }
  let next = 1
  for (let i = 1; i <= count; i++) {
    if (i === dropVer) continue
    map.set(i, next)
    next += 1
  }
  return { newCount: next - 1, map }
}

/**
 * When already at IMAGE_VER_MAX and saving another edit: drop VER_1 (oldest edit),
 * shift VER_2→VER_1 … VER_MAX→VER_{MAX-1}, new tip writes as VER_MAX.
 * Returns old→new map for existing versions (VER_1 omitted).
 */
export function renumberAfterShiftOldest(count: number): {
  newCount: number
  map: Map<number, number>
} {
  const map = new Map<number, number>()
  if (count < IMAGE_VER_MAX) {
    for (let i = 1; i <= count; i++) map.set(i, i)
    return { newCount: count, map }
  }
  for (let i = 2; i <= count; i++) map.set(i, i - 1)
  return { newCount: IMAGE_VER_MAX - 1, map }
}
