import {
  MEDIA_METADATA_ADS,
  MEDIA_METADATA_THUMB_ADS,
  parseMediaMetadataJson,
  type MediaMetadata
} from '@shared/mediaMetadata'
import { requireAbsolute } from '../fs/list'

export async function readMediaMetadata(rawPath: string): Promise<MediaMetadata | null> {
  const file = requireAbsolute(rawPath)
  const { readStreamText } = await import('../fs/adsWin32')
  const text = await readStreamText(file, MEDIA_METADATA_ADS)
  if (!text.trim()) return null
  return parseMediaMetadataJson(text)
}

export async function writeMediaMetadata(
  rawPath: string,
  meta: MediaMetadata,
  thumb?: Buffer | null
): Promise<void> {
  const file = requireAbsolute(rawPath)
  const { writeStreamText, writeStreamBytes } = await import('../fs/adsWin32')
  await writeStreamText(file, MEDIA_METADATA_ADS, JSON.stringify(meta, null, 2), false)
  if (thumb && thumb.length > 0) {
    await writeStreamBytes(file, MEDIA_METADATA_THUMB_ADS, thumb)
  }
}

export async function clearMediaMetadata(rawPath: string): Promise<{ cleared: boolean }> {
  const file = requireAbsolute(rawPath)
  const { deleteStream, streamExists } = await import('../fs/adsWin32')
  let cleared = false
  if (streamExists(file, MEDIA_METADATA_ADS)) {
    deleteStream(file, MEDIA_METADATA_ADS)
    cleared = true
  }
  if (streamExists(file, MEDIA_METADATA_THUMB_ADS)) {
    deleteStream(file, MEDIA_METADATA_THUMB_ADS)
    cleared = true
  }
  return { cleared }
}

export async function writeMediaThumbnail(rawPath: string, thumb: Buffer): Promise<void> {
  const file = requireAbsolute(rawPath)
  const { writeStreamBytes } = await import('../fs/adsWin32')
  await writeStreamBytes(file, MEDIA_METADATA_THUMB_ADS, thumb)
}

export async function readMediaThumbnail(rawPath: string): Promise<Buffer | null> {
  const file = requireAbsolute(rawPath)
  const { readStreamBytes } = await import('../fs/adsWin32')
  return readStreamBytes(file, MEDIA_METADATA_THUMB_ADS)
}

export async function hasMediaThumbnail(rawPath: string): Promise<boolean> {
  const file = requireAbsolute(rawPath)
  const { streamExists } = await import('../fs/adsWin32')
  return streamExists(file, MEDIA_METADATA_THUMB_ADS)
}
