import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { app } from 'electron'
import { AppError } from '@shared/result'
import { logMain } from '../logging'

/** HuggingFace Carve LaMa ONNX (fixed 512×512). */
export const LAMA_MODEL_URL =
  'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx'
export const LAMA_MODEL_FILENAME = 'lama_fp32.onnx'

function modelsDir(): string {
  return join(app.getPath('userData'), 'models')
}

export function lamaModelPath(): string {
  return join(modelsDir(), LAMA_MODEL_FILENAME)
}

async function fileReady(path: string): Promise<boolean> {
  try {
    const st = await stat(path)
    return st.isFile() && st.size > 1_000_000
  } catch {
    return false
  }
}

let inflight: Promise<{ path: string; downloaded: boolean }> | null = null

/**
 * Ensure LaMa ONNX exists under userData `models/`. Downloads once from HuggingFace.
 */
export async function ensureLamaModel(): Promise<{ path: string; downloaded: boolean }> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const dest = lamaModelPath()
      if (await fileReady(dest)) {
        return { path: dest, downloaded: false }
      }

      await mkdir(modelsDir(), { recursive: true })
      const tmp = `${dest}.download`
      try {
        await unlink(tmp).catch(() => undefined)
        logMain('info', `Downloading LaMa ONNX model → ${dest}`)
        const res = await fetch(LAMA_MODEL_URL, { redirect: 'follow' })
        if (!res.ok || !res.body) {
          throw new AppError(
            'io',
            `Failed to download LaMa model (HTTP ${res.status}). Check your network and try again.`
          )
        }
        const nodeStream = Readable.fromWeb(
          res.body as unknown as import('node:stream/web').ReadableStream
        )
        await pipeline(nodeStream, createWriteStream(tmp))
        await rename(tmp, dest)
        if (!(await fileReady(dest))) {
          throw new AppError('io', 'LaMa model download completed but file looks invalid.')
        }
        logMain('info', `LaMa ONNX model ready (${(await stat(dest)).size} bytes)`)
        return { path: dest, downloaded: true }
      } catch (e) {
        await unlink(tmp).catch(() => undefined)
        if (e instanceof AppError) throw e
        throw new AppError('io', e instanceof Error ? e.message : 'Failed to download LaMa model')
      }
    } finally {
      inflight = null
    }
  })()
  return inflight
}
