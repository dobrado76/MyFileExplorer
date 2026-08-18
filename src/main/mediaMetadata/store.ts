import path from 'node:path'
import fsp from 'node:fs/promises'
import {
  MEDIA_METADATA_ADS,
  MEDIA_METADATA_CONTAINER_ADS,
  MEDIA_METADATA_THUMB_ADS,
  isSeasonFolderName,
  parseMediaMetadataJson,
  type MediaMetadata,
  type MediaMetadataKind
} from '@shared/mediaMetadata'
import { requireAbsolute } from '../fs/list'

function isDriveRoot(abs: string): boolean {
  const n = abs.replace(/\//g, '\\').replace(/\\+$/, '')
  return /^[a-zA-Z]:$/i.test(n)
}

export async function hasMediaMetadataContainer(rawPath: string): Promise<boolean> {
  const dir = requireAbsolute(rawPath)
  if (process.platform !== 'win32') return false
  const { streamExists } = await import('../fs/adsWin32')
  return streamExists(dir, MEDIA_METADATA_CONTAINER_ADS)
}

export async function markMediaMetadataContainer(rawPath: string): Promise<void> {
  if (process.platform !== 'win32') return
  const dir = requireAbsolute(rawPath)
  if (isDriveRoot(dir) || dir.toLowerCase().startsWith('mfe-remote://')) return
  try {
    const st = await fsp.stat(dir)
    if (!st.isDirectory()) return
  } catch {
    return
  }
  const { streamExists, writeStreamText } = await import('../fs/adsWin32')
  if (streamExists(dir, MEDIA_METADATA_CONTAINER_ADS)) return
  await writeStreamText(
    dir,
    MEDIA_METADATA_CONTAINER_ADS,
    JSON.stringify({ version: 1, markedAt: new Date().toISOString() }),
    false
  )
}

export async function readMediaMetadata(rawPath: string): Promise<MediaMetadata | null> {
  const file = requireAbsolute(rawPath)
  const { readStreamText } = await import('../fs/adsWin32')
  const text = await readStreamText(file, MEDIA_METADATA_ADS)
  if (!text.trim()) return null
  return parseMediaMetadataJson(text)
}

export async function markContainersForKind(rawPath: string, kind: MediaMetadataKind): Promise<void> {
  const target = requireAbsolute(rawPath)
  try {
    const st = await fsp.stat(target)
    if (st.isFile()) {
      const parent = path.dirname(target)
      if (kind === 'episode') {
        const showDir = isSeasonFolderName(path.basename(parent)) ? path.dirname(parent) : parent
        await markMediaMetadataContainer(showDir)
        await markMediaMetadataContainer(path.dirname(showDir))
      } else {
        await markMediaMetadataContainer(parent)
      }
      return
    }
    if (kind === 'show') {
      await markMediaMetadataContainer(target)
      await markMediaMetadataContainer(path.dirname(target))
    } else {
      await markMediaMetadataContainer(target)
    }
  } catch {
    /* container flag is best-effort */
  }
}

export async function writeMediaMetadata(
  rawPath: string,
  meta: MediaMetadata,
  thumb?: Buffer | null
): Promise<void> {
  const file = requireAbsolute(rawPath)
  const { writeStreamText, writeStreamBytes, streamExists, deleteStream, withPreservedHostTimes } =
    await import('../fs/adsWin32')
  const noTimes = { preserveHostTimes: false } as const
  await withPreservedHostTimes(file, async () => {
    await writeStreamText(file, MEDIA_METADATA_ADS, JSON.stringify(meta, null, 2), false, noTimes)
    if (meta.kind === 'episode') {
      if (streamExists(file, MEDIA_METADATA_THUMB_ADS)) {
        deleteStream(file, MEDIA_METADATA_THUMB_ADS, noTimes)
      }
    } else if (thumb && thumb.length > 0) {
      await writeStreamBytes(file, MEDIA_METADATA_THUMB_ADS, thumb, noTimes)
    }
  })
  await markContainersForKind(file, meta.kind)
}

export async function clearMediaMetadata(rawPath: string): Promise<{ cleared: boolean }> {
  const file = requireAbsolute(rawPath)
  const { deleteStream, streamExists, withPreservedHostTimes } = await import('../fs/adsWin32')
  const noTimes = { preserveHostTimes: false } as const
  let cleared = false
  await withPreservedHostTimes(file, async () => {
    if (streamExists(file, MEDIA_METADATA_ADS)) {
      deleteStream(file, MEDIA_METADATA_ADS, noTimes)
      cleared = true
    }
    if (streamExists(file, MEDIA_METADATA_THUMB_ADS)) {
      deleteStream(file, MEDIA_METADATA_THUMB_ADS, noTimes)
      cleared = true
    }
  })
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
