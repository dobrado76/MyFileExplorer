/**
 * Shared filesystem walk for user-metadata pack export and orphan scan.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'

const DEFAULT_WALK_MAX = 50_000

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AppError('cancelled', 'Walk cancelled')
  }
}

/**
 * Walk files and directories under root (includes root). Cap default 50k.
 */
export async function walkUserMetadataHosts(
  root: string,
  opts?: { max?: number; signal?: AbortSignal }
): Promise<string[]> {
  const max = opts?.max ?? DEFAULT_WALK_MAX
  const out: string[] = []
  const stack = [root]
  const seen = new Set<string>()

  while (stack.length && out.length < max) {
    throwIfAborted(opts?.signal)
    const dir = stack.pop()!
    if (seen.has(dir)) continue
    seen.add(dir)
    out.push(dir)
    if (out.length >= max) break

    let ents
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      throwIfAborted(opts?.signal)
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        stack.push(full)
      } else if (e.isFile() || e.isSymbolicLink()) {
        out.push(full)
      }
      if (out.length >= max) break
    }
  }
  return out
}
