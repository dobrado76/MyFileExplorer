/**
 * Detect archive preview flavors from the basename (compound extensions first).
 */
import path from 'node:path'

export type PreviewArchiveFormat =
  | 'zip'
  | 'unitypackage'
  | '7z'
  | 'rar'
  | 'tar'
  | 'targz'
  | 'apk'
  | 'msi'
  | 'iso'
  | 'img'

/** Match longest compound suffixes before single-extension checks. */
export function detectArchiveFormat(filePath: string): PreviewArchiveFormat | null {
  const base = path.basename(filePath).toLowerCase()
  if (base.endsWith('.unitypackage')) return 'unitypackage'
  if (base.endsWith('.tar.gz') || base.endsWith('.tgz')) return 'targz'
  if (base.endsWith('.tar')) return 'tar'
  if (base.endsWith('.7z')) return '7z'
  if (base.endsWith('.rar')) return 'rar'
  if (base.endsWith('.apk')) return 'apk'
  if (base.endsWith('.msi')) return 'msi'
  if (base.endsWith('.iso')) return 'iso'
  if (base.endsWith('.img')) return 'img'
  if (base.endsWith('.zip')) return 'zip'
  return null
}

export function archiveTypeLabel(format: PreviewArchiveFormat): string {
  switch (format) {
    case 'zip':
      return 'Compressed (zipped) folder'
    case 'unitypackage':
      return 'Unity package'
    case '7z':
      return '7-Zip archive'
    case 'rar':
      return 'RAR archive'
    case 'tar':
      return 'TAR archive'
    case 'targz':
      return 'Gzipped TAR archive'
    case 'apk':
      return 'Android package'
    case 'msi':
      return 'Windows Installer package'
    case 'iso':
      return 'Disc image (ISO)'
    case 'img':
      return 'Disk image'
  }
}

export function archiveTreeLabel(format: PreviewArchiveFormat): string {
  switch (format) {
    case 'zip':
      return 'ZIP contents'
    case 'unitypackage':
      return 'Unity package contents'
    case '7z':
      return '7z contents'
    case 'rar':
      return 'RAR contents'
    case 'tar':
      return 'TAR contents'
    case 'targz':
      return 'TAR.GZ contents'
    case 'apk':
      return 'APK contents'
    case 'msi':
      return 'MSI contents'
    case 'iso':
      return 'ISO contents'
    case 'img':
      return 'IMG contents'
  }
}
