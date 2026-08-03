import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { AppError } from '@shared/result'
import {
  VID_THUMB_CACHE_DIR,
  VID_THUMB_FRAME_COUNT,
  isVidThumbVideoExt,
  sampleVidThumbTimestamps,
  vidThumbFrameFileName
} from '@shared/vidThumbCache'
import { requireAbsolute, pathExists } from '../fs/list'
import { setWinAttributeFlags, getFileAttributes, flagsFromAttributes } from '../fs/winAttrs'
import { beginOp } from '../fs/opProgress'
import { protocolAllowlist } from '../security/paths'

export type VidThumbMode = 'missing' | 'all'

export type GenerateVidThumbsResult = {
  generated: number
  skipped: number
  failed: { path: string; message: string }[]
}

function resolveFfmpegPath(): string {
  const raw = ffmpegStatic
  if (!raw) {
    throw new AppError('io', 'ffmpeg binary is not available in this build')
  }
  return raw.replace(/app\.asar(?!\.unpacked)/g, 'app.asar.unpacked')
}

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }))
  })
}

function parseDurationSeconds(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(stderr)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  const sec = Number(m[3])
  if (![h, min, sec].every((n) => Number.isFinite(n))) return null
  return h * 3600 + min * 60 + sec
}

async function probeDuration(videoPath: string): Promise<number> {
  const { stderr } = await runFfmpeg(['-hide_banner', '-i', videoPath])
  const dur = parseDurationSeconds(stderr)
  if (dur == null || dur <= 0) {
    throw new AppError('io', `Could not read duration for ${path.basename(videoPath)}`)
  }
  return dur
}

async function hasCompleteStrip(cacheDir: string, videoBase: string): Promise<boolean> {
  for (let i = 1; i <= VID_THUMB_FRAME_COUNT; i++) {
    const frame = path.join(cacheDir, vidThumbFrameFileName(videoBase, i))
    try {
      await fsp.access(frame)
    } catch {
      return false
    }
  }
  return true
}

async function ensureCacheDir(parentDir: string): Promise<string> {
  const cacheDir = path.join(parentDir, VID_THUMB_CACHE_DIR)
  await fsp.mkdir(cacheDir, { recursive: true })
  if (process.platform === 'win32') {
    try {
      const attrs = getFileAttributes(cacheDir)
      if (attrs != null) {
        const cur = flagsFromAttributes(attrs)
        if (!cur.hidden) setWinAttributeFlags(cacheDir, { ...cur, hidden: true })
      } else {
        setWinAttributeFlags(cacheDir, {
          readOnly: false,
          hidden: true,
          system: false,
          archive: false
        })
      }
    } catch {
      // Non-fatal — generation still works if Hidden can't be set.
    }
  }
  protocolAllowlist.allowDir(cacheDir)
  return cacheDir
}

async function collectVideos(rawPaths: string[], recursive: boolean): Promise<string[]> {
  const out: string[] = []
  const seen = new Set<string>()
  const visitedDirs = new Set<string>()

  const addFile = (full: string): void => {
    const key = full.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(full)
  }

  const walkDir = async (dir: string): Promise<void> => {
    const dirKey = dir.toLowerCase()
    if (visitedDirs.has(dirKey)) return
    visitedDirs.add(dirKey)

    let ents: string[]
    try {
      ents = await fsp.readdir(dir)
    } catch {
      return
    }
    for (const name of ents) {
      if (name === VID_THUMB_CACHE_DIR) continue
      const full = path.join(dir, name)
      let st
      try {
        st = await fsp.lstat(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (recursive) await walkDir(full)
        continue
      }
      if (!st.isFile()) continue
      const ext = path.extname(name).slice(1)
      if (!isVidThumbVideoExt(ext)) continue
      addFile(full)
    }
  }

  for (const raw of rawPaths) {
    const p = requireAbsolute(raw)
    let st
    try {
      st = await fsp.stat(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      await walkDir(p)
    } else if (st.isFile()) {
      const ext = path.extname(p).slice(1)
      if (isVidThumbVideoExt(ext)) addFile(p)
    }
  }
  return out
}

async function extractFrames(
  videoPath: string,
  cacheDir: string,
  onFrame: (name: string) => void
): Promise<void> {
  const base = path.basename(videoPath)
  const duration = await probeDuration(videoPath)
  const times = sampleVidThumbTimestamps(duration, VID_THUMB_FRAME_COUNT)

  for (let i = 0; i < times.length; i++) {
    const index = i + 1
    const outPath = path.join(cacheDir, vidThumbFrameFileName(base, index))
    const tmpPath = `${outPath}.tmp.jpg`
    const t = times[i]!
    // Input seek is fast enough for strip thumbs; accuracy is secondary to coverage.
    const { code, stderr } = await runFfmpeg([
      '-y',
      '-ss',
      t.toFixed(3),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      tmpPath
    ])
    if (code !== 0 || !(await pathExists(tmpPath))) {
      try {
        await fsp.unlink(tmpPath)
      } catch {
        /* ignore */
      }
      throw new AppError(
        'io',
        `Frame ${index} failed for ${base}`,
        stderr.trim().slice(-400) || undefined
      )
    }
    await fsp.rename(tmpPath, outPath)
    onFrame(vidThumbFrameFileName(base, index))
  }
}

/**
 * Generate `!VIDTHUMB_CACHE` strip frames for videos (or all videos in folders).
 * Non-recursive for directories — matches the current folder view.
 */
export async function generateVidThumbStrips(
  paths: string[],
  mode: VidThumbMode,
  recursive = false
): Promise<GenerateVidThumbsResult> {
  const videos = await collectVideos(paths, recursive)
  if (videos.length === 0) {
    return { generated: 0, skipped: 0, failed: [] }
  }

  const todo: string[] = []
  let skipped = 0
  for (const video of videos) {
    const cacheDir = path.join(path.dirname(video), VID_THUMB_CACHE_DIR)
    if (mode === 'missing' && (await hasCompleteStrip(cacheDir, path.basename(video)))) {
      skipped++
      continue
    }
    todo.push(video)
  }

  const total = Math.max(todo.length * VID_THUMB_FRAME_COUNT, 0)
  const progress = beginOp('vid-thumbs', total, 'Video previews…')
  const failed: { path: string; message: string }[] = []
  let generated = 0

  try {
    for (const video of todo) {
      let framesDone = 0
      try {
        const cacheDir = await ensureCacheDir(path.dirname(video))
        await extractFrames(video, cacheDir, (name) => {
          framesDone++
          progress.tick(name)
        })
        generated++
      } catch (e) {
        const message = e instanceof AppError ? e.message : e instanceof Error ? e.message : String(e)
        failed.push({ path: video, message })
        const remain = VID_THUMB_FRAME_COUNT - framesDone
        if (remain > 0) progress.advance(remain, path.basename(video))
      }
    }
    progress.finish()
  } catch (e) {
    progress.fail()
    throw e
  }

  return { generated, skipped, failed }
}
