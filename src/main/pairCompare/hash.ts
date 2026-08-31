import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import type { Readable } from 'node:stream'

const HASH_CONCURRENCY = 2

export async function hashFileSha256(
  absolutePath: string,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) throw new Error('cancelled')
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream: Readable = fs.createReadStream(absolutePath)
    const onAbort = (): void => {
      stream.destroy()
      reject(new Error('cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    stream.on('data', (chunk: Buffer) => {
      if (signal?.aborted) {
        stream.destroy()
        return
      }
      hash.update(chunk)
    })
    stream.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    stream.on('end', () => {
      signal?.removeEventListener('abort', onAbort)
      resolve(hash.digest('hex'))
    })
  })
}

type HashJob = {
  path: string
  size: number | null
  modifiedMs: number | null
  resolve: (h: string) => void
  reject: (e: unknown) => void
}

/** Session-scoped hash cache + bounded concurrency. */
export class HashCache {
  private cache = new Map<string, string>()
  private queue: HashJob[] = []
  private active = 0
  private signal?: AbortSignal

  constructor(signal?: AbortSignal) {
    this.signal = signal
  }

  private cacheKey(path: string, size: number | null, modifiedMs: number | null): string {
    return `${path}|${size ?? ''}|${modifiedMs ?? ''}`
  }

  async get(
    path: string,
    size: number | null,
    modifiedMs: number | null
  ): Promise<string> {
    const key = this.cacheKey(path, size, modifiedMs)
    const hit = this.cache.get(key)
    if (hit) return hit
    return new Promise((resolve, reject) => {
      this.queue.push({ path, size, modifiedMs, resolve, reject })
      this.pump()
    })
  }

  private pump(): void {
    while (this.active < HASH_CONCURRENCY && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.active++
      void (async () => {
        try {
          const h = await hashFileSha256(job.path, this.signal)
          this.cache.set(this.cacheKey(job.path, job.size, job.modifiedMs), h)
          job.resolve(h)
        } catch (e) {
          job.reject(e)
        } finally {
          this.active--
          this.pump()
        }
      })()
    }
  }

  clear(): void {
    this.cache.clear()
    this.queue = []
  }
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}
