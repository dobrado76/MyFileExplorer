/** Sibling cache folder used by external tools for per-video strip frames. */
export const VID_THUMB_CACHE_DIR = '!VIDTHUMB_CACHE'

/** Expected frame count (1…N). */
export const VID_THUMB_FRAME_COUNT = 20

/** Default playback interval in the icon grid (settings `vidThumbFrameMs`). */
export const DEFAULT_VID_THUMB_FRAME_MS = 300

/** Allowed range for `vidThumbFrameMs` in settings. */
export const VID_THUMB_FRAME_MS_MIN = 50
export const VID_THUMB_FRAME_MS_MAX = 2000

const VIDEO_EXTS = new Set([
  'mp4',
  'mkv',
  'webm',
  'avi',
  'divx',
  'mov',
  'wmv',
  'm4v',
  'mpg',
  'mpeg'
])

export function isVidThumbVideoExt(ext: string): boolean {
  return VIDEO_EXTS.has(ext.replace(/^\./, '').toLowerCase())
}

/** `video.mp4` → `video.mp4.thumb_3.jpg` */
export function vidThumbFrameFileName(videoBaseName: string, index: number): string {
  return `${videoBaseName}.thumb_${index}.jpg`
}

/** Even samples: center of N equal segments across [0, duration). */
export function sampleVidThumbTimestamps(durationSec: number, count: number): number[] {
  const n = Math.max(1, count)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = (durationSec * (i + 0.5)) / n
    // Keep a tiny margin off the exact end for demuxer safety.
    out.push(Math.min(Math.max(0, t), Math.max(0, durationSec - 0.05)))
  }
  return out
}
