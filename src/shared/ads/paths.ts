/**
 * Pure NTFS ADS path helpers (Trinet.Core.IO.Ntfs parity).
 * Safe to unit-test without Win32.
 */

export const ADS_STREAM_SEPARATOR = ':'
export const ADS_DATA_SUFFIX = '$DATA'
export const ADS_MAX_PATH = 256
export const ADS_LONG_PATH_PREFIX = '\\\\?\\'

/** Invalid stream-name chars (file-name invalids; control 1–31 allowed in ADS). */
const NODE_INVALID = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

/**
 * Build `path:streamName:$DATA`, prefixing `\\?\` when the result is long.
 * Matches Trinet SafeNativeMethods.BuildStreamPath.
 */
export function buildStreamPath(filePath: string, streamName: string): string {
  let result = filePath
  if (!filePath) return result
  if (result.length === 1) result = '.\\' + result
  result += ADS_STREAM_SEPARATOR + streamName + ADS_STREAM_SEPARATOR + ADS_DATA_SUFFIX
  if (result.length >= ADS_MAX_PATH) result = ADS_LONG_PATH_PREFIX + result
  return result
}

/**
 * Parse BackupRead stream name (`:NAME:$DATA\0`) → `NAME`.
 * Empty / primary data → null (omit from ADS lists).
 */
export function parseBackupStreamName(raw: string): string | null {
  if (!raw) return null
  const sep = raw.indexOf(ADS_STREAM_SEPARATOR, 1)
  if (sep !== -1) {
    const name = raw.slice(1, sep)
    return name.length > 0 ? name : null
  }
  const nul = raw.indexOf('\0')
  if (nul > 1) {
    const name = raw.slice(1, nul)
    return name.length > 0 ? name : null
  }
  return null
}

export function validateStreamName(streamName: string): void {
  if (!streamName) return
  for (const ch of streamName) {
    if (NODE_INVALID.has(ch)) {
      throw new Error('Stream name contains invalid characters')
    }
  }
}

/** Skip reading huge streams for Details / ADS Manager value preview. */
export const ADS_VALUE_PREVIEW_MAX_BYTES = 64 * 1024

export function isValidAdsStreamName(name: string): boolean {
  if (!name || name.length > 255) return false
  try {
    validateStreamName(name)
    return true
  } catch {
    return false
  }
}

/** Display string for Details column: comma-separated alternate stream names. */
export function formatAdsColumnValue(names: string[]): string {
  return names.filter((n) => n.length > 0).join(', ')
}

/**
 * ADS Manager “Value” cell: show the text when it is a single line / scalar;
 * otherwise `[...]` (multi-line, controls, or empty-after-binary).
 */
export function formatAdsValuePreview(text: string): string {
  if (!text) return ''
  if (/[\r\n]/.test(text)) return '[...]'
  // Non-text / binary payload (allow tab).
  // eslint-disable-next-line no-control-regex -- intentional C0 control check (excl. tab/\n/\r)
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return '[...]'
  return text
}
