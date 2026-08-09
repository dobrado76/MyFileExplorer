/** Shared path to bundled ffmpeg (asar-unpacked in production). */
import { spawn, type ChildProcess } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-static'

export function resolveFfmpegPath(): string | null {
  const raw = ffmpegStatic
  if (!raw) return null
  return raw.replace(/app\.asar(?!\.unpacked)/g, 'app.asar.unpacked')
}

export function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  const bin = resolveFfmpegPath()
  if (!bin) return Promise.resolve({ code: 1, stderr: 'no ffmpeg' })
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 32_000) stderr = stderr.slice(-16_000)
    })
    child.on('error', () => resolve({ code: 1, stderr }))
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }))
  })
}

/** Spawn ffmpeg; caller owns lifecycle (kill / close). */
export function spawnFfmpeg(args: string[]): ChildProcess | null {
  const bin = resolveFfmpegPath()
  if (!bin) return null
  return spawn(bin, args, {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe']
  })
}
