/** Raster formats we can edit in-place via Sharp re-encode. */
const EDITABLE_IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'avif',
  'tiff',
  'tif'
])

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
