import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import { isMediaMetadataVideoName } from '@shared/mediaMetadata'

/**
 * Privacy gate for D50 remote lookups (TMDB / OMDb / Plex HTTP).
 * Only video files, or folders that contain at least one video, may trigger network queries.
 * Callers must still send title strings only — never file bytes (see assertSafeMediaMetadataOutboundTitle).
 */
export async function requireMediaMetadataNetworkTarget(
  absPath: string
): Promise<'video-file' | 'video-folder'> {
  let st
  try {
    st = await fsp.stat(absPath)
  } catch {
    throw new AppError('not-found', 'Path not found')
  }
  if (st.isFile()) {
    if (!isMediaMetadataVideoName(path.basename(absPath))) {
      throw new AppError(
        'validation',
        'Online media lookup only runs for video files (never images, subtitles, or other files)'
      )
    }
    return 'video-file'
  }
  if (st.isDirectory()) {
    if (!(await folderContainsVideo(absPath))) {
      throw new AppError(
        'validation',
        'Folder has no video files — nothing to look up online'
      )
    }
    return 'video-folder'
  }
  throw new AppError(
    'validation',
    'Online media lookup only runs for video files or folders that contain them'
  )
}

/** Shallow + one-level scan (same idea as first-video quick pick). */
async function folderContainsVideo(dir: string): Promise<boolean> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  const subdirs: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.isFile() && isMediaMetadataVideoName(e.name)) return true
    if (e.isDirectory()) subdirs.push(path.join(dir, e.name))
  }
  for (const sub of subdirs) {
    let kids: import('node:fs').Dirent[]
    try {
      kids = await fsp.readdir(sub, { withFileTypes: true })
    } catch {
      continue
    }
    if (kids.some((e) => e.isFile() && isMediaMetadataVideoName(e.name))) return true
  }
  return false
}
