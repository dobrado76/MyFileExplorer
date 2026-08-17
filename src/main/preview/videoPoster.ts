/**
 * Still-frame posters for video containers Chromium can’t play inline (MKV, etc.).
 * Prefers an existing !VIDTHUMB_CACHE frame; otherwise extracts one via ffmpeg.
 */
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { VID_THUMB_CACHE_DIR, vidThumbFrameFileName } from '@shared/vidThumbCache'
import { mediaUrlFor } from '../media/protocol'
import { protocolAllowlist } from '../security/paths'
import { runFfmpeg } from './ffmpegBin'

/** Containers Chromium’s <video> usually cannot demux — remux via ffmpeg for preview. */
export const CHROMIUM_WEAK_VIDEO_EXTS = new Set([
  'mkv',
  'wmv',
  'mpg',
  'mpeg',
  'ts',
  'm2ts',
  'flv'
])

/**
 * No in-pane `<video>` (codecs too hostile / convert too heavy). Preview shows
 * `!VIDTHUMB_CACHE` strip when present + Open with default app.
 */
export const STRIP_ONLY_VIDEO_EXTS = new Set(['avi', 'divx', 'rmvb', 'rm'])

function posterCacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'video-posters')
  protocolAllowlist.allowDirPermanently(dir)
  return dir
}

function posterCachePath(videoPath: string, mtimeMs: number, size: number): string {
  const key = crypto
    .createHash('sha1')
    .update(`${videoPath.toLowerCase()}|${mtimeMs}|${size}|v1`)
    .digest('hex')
  return path.join(posterCacheDir(), `${key}.jpg`)
}

async function existingVidThumbFrame(videoPath: string): Promise<string | null> {
  const base = path.basename(videoPath)
  const frame = path.join(path.dirname(videoPath), VID_THUMB_CACHE_DIR, vidThumbFrameFileName(base, 1))
  try {
    const st = await fsp.stat(frame)
    if (st.isFile() && st.size > 0) {
      protocolAllowlist.allowDir(path.dirname(frame))
      return frame
    }
  } catch {
    // none
  }
  return null
}

async function extractPosterFrame(videoPath: string, destJpg: string): Promise<boolean> {
  await fsp.mkdir(path.dirname(destJpg), { recursive: true })
  const tmp = destJpg + '.tmp.jpg'
  const { code } = await runFfmpeg([
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    '1',
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    '-vf',
    'scale=640:-2',
    '-y',
    tmp
  ])
  if (code !== 0) {
    const retry = await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      '-vf',
      'scale=640:-2',
      '-y',
      tmp
    ])
    if (retry.code !== 0) {
      try {
        await fsp.unlink(tmp)
      } catch {
        // ignore
      }
      return false
    }
  }
  try {
    await fsp.rename(tmp, destJpg)
    return true
  } catch {
    try {
      await fsp.unlink(tmp)
    } catch {
      // ignore
    }
    return false
  }
}

/**
 * Resolve a JPEG poster URL for preview. Returns null if nothing can be produced.
 */
export async function resolveVideoPosterUrl(
  videoPath: string,
  mtimeMs: number,
  size: number
): Promise<string | null> {
  const cached = posterCachePath(videoPath, mtimeMs, size)
  try {
    const st = await fsp.stat(cached)
    if (st.isFile() && st.size > 0) return mediaUrlFor(cached, `${mtimeMs}-${size}`)
  } catch {
    // generate
  }

  const strip = await existingVidThumbFrame(videoPath)
  if (strip) {
    try {
      await fsp.copyFile(strip, cached)
      return mediaUrlFor(cached, `${mtimeMs}-${size}`)
    } catch {
      protocolAllowlist.allowDir(path.dirname(strip))
      return mediaUrlFor(strip, `${mtimeMs}-${size}`)
    }
  }

  const ok = await extractPosterFrame(videoPath, cached)
  if (!ok) return null
  return mediaUrlFor(cached, `${mtimeMs}-${size}`)
}
