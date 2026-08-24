/**
 * userData/media-scratch — large non-AV mfe-media copies (D7).
 * Emptied on start/quit; mid-session cap evicts oldest first.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export const MAX_MEDIA_SCRATCH_FILES = 20

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a)
  const right = path.resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

type ScratchFile = { name: string; filePath: string; mtimeMs: number }

async function listCompletedScratch(dir: string): Promise<ScratchFile[]> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return []
  }
  const out: ScratchFile[] = []
  for (const name of names) {
    if (name.endsWith('.tmp')) continue
    const filePath = path.join(dir, name)
    try {
      const st = await fsp.stat(filePath)
      if (st.isFile()) out.push({ name, filePath, mtimeMs: st.mtimeMs })
    } catch {
      /* gone */
    }
  }
  return out
}

/** Wipe the folder and recreate it empty. */
export async function emptyMediaScratchDir(dir: string): Promise<void> {
  await fsp.rm(dir, { recursive: true, force: true })
  await fsp.mkdir(dir, { recursive: true })
}

/** Sync wipe for `before-quit` so the process does not exit mid-delete. */
export function emptyMediaScratchDirSync(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * Make room for `keepPath` so completed files stay at `max`.
 * If `keepPath` already exists it is never deleted; otherwise one slot is reserved.
 * Locked / busy files are skipped (Windows may hold a preview handle).
 */
export async function evictOldestMediaScratch(
  dir: string,
  opts: { keepPath: string; max?: number }
): Promise<void> {
  const max = opts.max ?? MAX_MEDIA_SCRATCH_FILES
  if (max < 1) return

  const files = await listCompletedScratch(dir)
  const destExists = files.some((f) => samePath(f.filePath, opts.keepPath))
  let overflow = files.length + (destExists ? 0 : 1) - max
  if (overflow <= 0) return

  const victims = files
    .filter((f) => !samePath(f.filePath, opts.keepPath))
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name))

  for (const v of victims) {
    if (overflow <= 0) break
    try {
      await fsp.unlink(v.filePath)
      overflow--
    } catch {
      /* locked or already gone */
    }
  }
}
