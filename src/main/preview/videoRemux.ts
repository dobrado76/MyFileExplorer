/**
 * Prepare Chromium-hostile containers (AVI, MKV, …) for `<video>`.
 * Stream-copy when codecs are browser-safe; otherwise H.264+AAC under userData.
 *
 * AVI/WMV/MPEG always get a short preview clip (re-encoding a whole movie is
 * too slow for the preview pane). Jobs time out so the UI never sticks on
 * “Converting…”.
 */
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { mediaUrlFor } from '../media/protocol'
import { protocolAllowlist } from '../security/paths'
import { runFfmpeg, spawnFfmpeg } from './ffmpegBin'

type RemuxJob = {
  key: string
  child: ReturnType<typeof spawnFfmpeg> | null
  promise: Promise<string | null>
  timer: ReturnType<typeof setTimeout> | null
}

type PrepMode = 'copy' | 'aac' | 'h264aac'

/** Bump when output recipe changes so stale caches are ignored. */
const CACHE_VER = 'mp4-v4'

/** Always re-encode — stream-copy yields audio-only + wrong control chrome. */
const FORCE_TRANSCODE_EXTS = new Set(['wmv', 'mpg', 'mpeg', 'flv'])

/** When a non-force container still needs re-encode and is huge, clip it. */
const LARGE_REENCODE_BYTES = 80 * 1024 * 1024

/** Preview clip length for re-encoded sources (seconds). */
const PREVIEW_CLIP_SEC = 120

/** Kill hung ffmpeg so the UI can leave “Converting…”. */
const CONVERT_TIMEOUT_MS = 45_000

const SAFE_VIDEO = new Set(['h264', 'avc', 'avc1', 'vp8', 'vp9', 'av1', 'av01'])

const SAFE_AUDIO = new Set([
  'aac',
  'mp3',
  'mp4a',
  'opus',
  'vorbis',
  'flac',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_u8'
])

let active: RemuxJob | null = null

function remuxCacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'video-remux')
  protocolAllowlist.allowDirPermanently(dir)
  return dir
}

function remuxCachePath(videoPath: string, mtimeMs: number, size: number, clip: boolean): string {
  const key = crypto
    .createHash('sha1')
    .update(`${videoPath.toLowerCase()}|${mtimeMs}|${size}|${CACHE_VER}|${clip ? 'clip' : 'full'}`)
    .digest('hex')
  return path.join(remuxCacheDir(), `${key}.mp4`)
}

function jobKey(videoPath: string, mtimeMs: number, size: number, force: boolean): string {
  return `${videoPath.toLowerCase()}|${mtimeMs}|${size}|${CACHE_VER}|${force ? 'f' : 'n'}`
}

async function fileNonEmpty(p: string): Promise<boolean> {
  try {
    const st = await fsp.stat(p)
    return st.isFile() && st.size > 0
  } catch {
    return false
  }
}

function killJob(job: RemuxJob | null): void {
  if (!job) return
  if (job.timer) {
    clearTimeout(job.timer)
    job.timer = null
  }
  try {
    job.child?.kill()
  } catch {
    // ignore
  }
}

function killActiveIfDifferent(key: string): void {
  if (!active || active.key === key) return
  killJob(active)
  active = null
}

function normalizeCodec(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function extOf(filePath: string): string {
  return path.extname(filePath).replace(/^\./, '').toLowerCase()
}

async function probeCodecs(
  videoPath: string
): Promise<{ video: string | null; audio: string | null }> {
  const { stderr } = await runFfmpeg(['-hide_banner', '-i', videoPath])
  let video: string | null = null
  let audio: string | null = null
  for (const line of stderr.split(/\r?\n/)) {
    if (!video) {
      const vm = /Stream #\d+:\d+(?:\([^)]*\))?: Video:\s*([^\s,(]+)/i.exec(line)
      if (vm) video = normalizeCodec(vm[1]!)
    }
    if (!audio) {
      const am = /Stream #\d+:\d+(?:\([^)]*\))?: Audio:\s*([^\s,(]+)/i.exec(line)
      if (am) audio = normalizeCodec(am[1]!)
    }
  }
  return { video, audio }
}

function pickMode(video: string | null, audio: string | null, ext: string): PrepMode {
  if (FORCE_TRANSCODE_EXTS.has(ext)) return 'h264aac'
  const vSafe = Boolean(video && SAFE_VIDEO.has(video))
  const aSafe = !audio || SAFE_AUDIO.has(audio)
  if (vSafe && aSafe) return 'copy'
  if (vSafe && !aSafe) return 'aac'
  return 'h264aac'
}

function clipSecondsFor(ext: string, size: number, mode: PrepMode): number | null {
  if (mode === 'copy' || mode === 'aac') return null
  if (FORCE_TRANSCODE_EXTS.has(ext)) return PREVIEW_CLIP_SEC
  if (size > LARGE_REENCODE_BYTES) return PREVIEW_CLIP_SEC
  return null
}

function runTrackedArgs(
  args: string[],
  onChild: (child: RemuxJob['child']) => void
): Promise<{ code: number; child: RemuxJob['child'] }> {
  const child = spawnFfmpeg(args)
  onChild(child)
  if (!child) return Promise.resolve({ code: 1, child: null })
  return new Promise((resolve) => {
    child.on('error', () => resolve({ code: 1, child }))
    child.on('close', (code) => resolve({ code: code ?? 1, child }))
  })
}

function buildArgs(
  videoPath: string,
  tmp: string,
  mode: PrepMode,
  clipSec: number | null
): string[] {
  const commonHead = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-fflags',
    '+genpts',
    '-y',
    '-i',
    videoPath
  ]
  if (clipSec != null) {
    commonHead.push('-t', String(clipSec))
  }
  commonHead.push('-map', '0:v:0', '-map', '0:a:0?', '-sn')

  const h264 = [
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '28',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    'scale=854:-2:force_original_aspect_ratio=decrease',
    '-profile:v',
    'baseline',
    '-threads',
    '0'
  ]

  const aac = ['-c:a', 'aac', '-b:a', '128k', '-ac', '2']
  const outFlags = ['-movflags', '+faststart']

  switch (mode) {
    case 'copy':
      return [...commonHead, '-c', 'copy', ...outFlags, tmp]
    case 'aac':
      return [...commonHead, '-c:v', 'copy', ...aac, ...outFlags, tmp]
    case 'h264aac':
      return [...commonHead, ...h264, ...aac, ...outFlags, tmp]
  }
}

async function convertOnce(
  videoPath: string,
  destMp4: string,
  mode: PrepMode,
  clipSec: number | null,
  onChild: (child: RemuxJob['child']) => void
): Promise<boolean> {
  await fsp.mkdir(path.dirname(destMp4), { recursive: true })
  const tmp = destMp4 + '.tmp.mp4'
  try {
    await fsp.unlink(tmp)
  } catch {
    // ignore
  }

  const { code } = await runTrackedArgs(buildArgs(videoPath, tmp, mode, clipSec), onChild)
  if (code !== 0) {
    try {
      await fsp.unlink(tmp)
    } catch {
      // ignore
    }
    return false
  }
  try {
    await fsp.rename(tmp, destMp4)
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

/** Cached playable URL if a remux/transcode already exists. */
export async function cachedPlayableVideoUrl(
  videoPath: string,
  mtimeMs: number,
  size: number
): Promise<string | null> {
  const ext = extOf(videoPath)
  const candidates = FORCE_TRANSCODE_EXTS.has(ext)
    ? [remuxCachePath(videoPath, mtimeMs, size, true)]
    : [
        remuxCachePath(videoPath, mtimeMs, size, false),
        remuxCachePath(videoPath, mtimeMs, size, true)
      ]
  for (const dest of candidates) {
    if (await fileNonEmpty(dest)) {
      return mediaUrlFor(dest, `${mtimeMs}-${size}-${CACHE_VER}`)
    }
  }
  return null
}

/**
 * Remux or transcode to a Chromium-playable MP4 under userData.
 * Always settles (success, failure, or timeout) so the UI can leave “Converting…”.
 */
export async function ensurePlayableVideoUrl(
  videoPath: string,
  mtimeMs: number,
  size: number,
  opts?: { force?: boolean }
): Promise<string | null> {
  const force = Boolean(opts?.force)
  const ext = extOf(videoPath)

  if (force) {
    for (const clip of [true, false]) {
      try {
        await fsp.unlink(remuxCachePath(videoPath, mtimeMs, size, clip))
      } catch {
        // ignore
      }
    }
  } else {
    const cached = await cachedPlayableVideoUrl(videoPath, mtimeMs, size)
    if (cached) return cached
  }

  const key = jobKey(videoPath, mtimeMs, size, force)
  if (active?.key === key) return active.promise

  killActiveIfDifferent(key)

  let settled = false
  let resolveJob!: (url: string | null) => void
  const promise = new Promise<string | null>((resolve) => {
    resolveJob = resolve
  })

  const finish = (url: string | null): void => {
    if (settled) return
    settled = true
    if (active?.key === key) {
      if (active.timer) {
        clearTimeout(active.timer)
        active.timer = null
      }
      active = null
    }
    resolveJob(url)
  }

  const job: RemuxJob = { key, child: null, promise, timer: null }
  active = job

  void (async () => {
    try {
      const codecs = await probeCodecs(videoPath)
      let mode: PrepMode = force ? 'h264aac' : pickMode(codecs.video, codecs.audio, ext)
      if (!codecs.video) mode = 'h264aac'

      const clipSec = force ? PREVIEW_CLIP_SEC : clipSecondsFor(ext, size, mode)
      const dest = remuxCachePath(videoPath, mtimeMs, size, clipSec != null)

      const onChild = (child: RemuxJob['child']): void => {
        if (active?.key === key) active.child = child
      }

      // Timeout covers encode only (probe can be slow on cold disks).
      job.timer = setTimeout(() => {
        killJob(job)
        finish(null)
      }, CONVERT_TIMEOUT_MS)

      let ok = await convertOnce(videoPath, dest, mode, clipSec, onChild)
      if (!ok && mode !== 'h264aac') {
        ok = await convertOnce(
          videoPath,
          dest,
          'h264aac',
          clipSec ?? PREVIEW_CLIP_SEC,
          onChild
        )
      }

      if (settled) return

      if (!ok || !(await fileNonEmpty(dest))) {
        finish(null)
        return
      }

      if (mode !== 'copy') {
        const out = await probeCodecs(dest)
        if (!out.video || !SAFE_VIDEO.has(out.video)) {
          try {
            await fsp.unlink(dest)
          } catch {
            // ignore
          }
          finish(null)
          return
        }
      }

      finish(mediaUrlFor(dest, `${mtimeMs}-${size}-${CACHE_VER}`))
    } catch {
      finish(null)
    }
  })()

  return promise
}
